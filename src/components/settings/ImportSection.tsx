import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useSchool } from '@/contexts/SchoolContext';
import { supabase } from '@/integrations/supabase/client';
import { Download, Upload, CheckCircle2, XCircle, Loader2, FileSpreadsheet } from 'lucide-react';

import { ImportEntityKey, IMPORT_ENTITY_LABELS, IMPORT_ENTITY_ORDER, ImportContext, ImportRowError, ImportExecutionResult } from '@/lib/import/types';
import { downloadImportTemplate } from '@/lib/import/templates';
import { parseImportFile } from '@/lib/import/parse';
import { validateClassesRows, validateTeachersRows, validateStudentsRows, validateContractsRows } from '@/lib/import/validate';
import { executeClassesImport, executeTeachersImport, executeStudentsImport, executeContractsImport } from '@/lib/import/execute';

type Stage = 'idle' | 'validating' | 'preview' | 'importing' | 'done';

interface PendingImport {
  validRows: Array<{ row: number; data: any }>;
  errors: ImportRowError[];
  totalRows: number;
}

const ENTITY_HELP: Record<ImportEntityKey, string> = {
  classes: 'Nome, série, capacidade, mensalidade de referência e, opcionalmente, professor(es) já cadastrado(s).',
  teachers: 'Nome, e-mail (único em toda a plataforma), telefone e salário.',
  students: 'Dados cadastrais do aluno e, opcionalmente, a turma (precisa já existir).',
  contracts: 'A matrícula financeira do aluno: valor, desconto, vencimento e datas. É o que gera as mensalidades automaticamente.',
};

async function fetchImportContext(schoolId: string): Promise<ImportContext> {
  const [classesRes, teachersRes, studentsRes] = await Promise.all([
    supabase.from('classes').select('id, name').eq('school_id', schoolId),
    supabase.from('teachers').select('id, email').eq('school_id', schoolId),
    (supabase as any).from('students').select('id, full_name, email').eq('school_id', schoolId),
  ]);

  return {
    schoolId,
    existingClasses: classesRes.data ?? [],
    existingTeachers: teachersRes.data ?? [],
    existingStudents: studentsRes.data ?? [],
  };
}

export function ImportSection() {
  const { schoolId } = useSchool();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [entity, setEntity] = useState<ImportEntityKey>('classes');
  const [stage, setStage] = useState<Stage>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [result, setResult] = useState<ImportExecutionResult | null>(null);

  const resetToIdle = () => {
    setStage('idle');
    setFileName(null);
    setPending(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleEntityChange = (value: string) => {
    setEntity(value as ImportEntityKey);
    resetToIdle();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !schoolId) return;

    setFileName(file.name);
    setStage('validating');
    setResult(null);

    try {
      const rawRows = await parseImportFile(file);
      const context = await fetchImportContext(schoolId);

      let validation;
      switch (entity) {
        case 'classes':
          validation = validateClassesRows(rawRows, context);
          break;
        case 'teachers':
          validation = validateTeachersRows(rawRows, context);
          break;
        case 'students':
          validation = validateStudentsRows(rawRows, context);
          break;
        case 'contracts':
          validation = validateContractsRows(rawRows, context);
          break;
      }

      setPending({ validRows: validation.valid, errors: validation.errors, totalRows: validation.totalRows });
      setStage('preview');
    } catch (err: any) {
      toast({
        title: 'Erro ao ler o arquivo',
        description: err?.message ?? 'Verifique se é um arquivo .xlsx válido, gerado a partir do modelo.',
        variant: 'destructive',
      });
      resetToIdle();
    }
  };

  const handleConfirmImport = async () => {
    if (!pending || !schoolId || pending.validRows.length === 0) return;
    setStage('importing');

    try {
      let execResult: ImportExecutionResult;
      switch (entity) {
        case 'classes':
          execResult = await executeClassesImport(pending.validRows, schoolId);
          break;
        case 'teachers':
          execResult = await executeTeachersImport(pending.validRows, schoolId);
          break;
        case 'students':
          execResult = await executeStudentsImport(pending.validRows, schoolId);
          break;
        case 'contracts':
          execResult = await executeContractsImport(pending.validRows, schoolId);
          break;
      }
      setResult(execResult);
      setStage('done');
      toast({
        title: 'Importação concluída',
        description: `${execResult.successCount} importado(s) com sucesso${execResult.failureCount > 0 ? `, ${execResult.failureCount} com erro` : ''}.`,
      });
    } catch (err: any) {
      toast({ title: 'Erro na importação', description: err?.message ?? 'Erro inesperado.', variant: 'destructive' });
      setStage('preview');
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-primary" />
          <CardTitle>Importação em Massa</CardTitle>
        </div>
        <CardDescription>
          Baixe o modelo, preencha e envie de volta para cadastrar vários registros de uma vez.
          Ordem recomendada: Turmas → Professores → Alunos → Matrículas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Tabs value={entity} onValueChange={handleEntityChange}>
          <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full">
            {IMPORT_ENTITY_ORDER.map((key) => (
              <TabsTrigger key={key} value={key}>{IMPORT_ENTITY_LABELS[key]}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <p className="text-sm text-muted-foreground">{ENTITY_HELP[entity]}</p>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button type="button" variant="outline" className="gap-2" onClick={() => downloadImportTemplate(entity)}>
            <Download className="h-4 w-4" />
            Baixar modelo de {IMPORT_ENTITY_LABELS[entity].toLowerCase()}
          </Button>

          <Button
            type="button"
            className="gap-2"
            disabled={stage === 'validating' || stage === 'importing'}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            Enviar planilha preenchida
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileSelected}
          />
        </div>

        {fileName && (
          <p className="text-xs text-muted-foreground">Arquivo: {fileName}</p>
        )}

        {stage === 'validating' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lendo e validando a planilha...
          </div>
        )}

        {(stage === 'preview' || stage === 'importing') && pending && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> {pending.validRows.length} linha(s) válida(s)
              </span>
              {pending.errors.length > 0 && (
                <span className="flex items-center gap-1.5 text-destructive">
                  <XCircle className="h-4 w-4" /> {pending.errors.length} linha(s) com erro
                </span>
              )}
              <span className="text-muted-foreground">de {pending.totalRows} linha(s) na planilha</span>
            </div>

            {pending.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Linhas que não serão importadas</AlertTitle>
                <AlertDescription>
                  <div className="max-h-56 overflow-y-auto mt-2 space-y-1">
                    {pending.errors.map((e, i) => (
                      <p key={i} className="text-xs">
                        <span className="font-semibold">Linha {e.row}{e.field ? ` (${e.field})` : ''}:</span> {e.message}
                      </p>
                    ))}
                  </div>
                  <p className="text-xs mt-2">Corrija essas linhas na planilha e envie novamente — só elas precisam ser reenviadas.</p>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                onClick={handleConfirmImport}
                disabled={pending.validRows.length === 0 || stage === 'importing'}
                className="gap-2"
              >
                {stage === 'importing' && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar importação de {pending.validRows.length} registro(s)
              </Button>
              <Button type="button" variant="outline" onClick={resetToIdle} disabled={stage === 'importing'}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {stage === 'done' && result && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> {result.successCount} importado(s)
              </span>
              {result.failureCount > 0 && (
                <span className="flex items-center gap-1.5 text-destructive">
                  <XCircle className="h-4 w-4" /> {result.failureCount} falharam
                </span>
              )}
            </div>
            {result.failureCount > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Falhas durante a importação</AlertTitle>
                <AlertDescription>
                  <div className="max-h-56 overflow-y-auto mt-2 space-y-1">
                    {result.outcomes.filter((o) => !o.success).map((o, i) => (
                      <p key={i} className="text-xs">
                        <span className="font-semibold">Linha {o.row}:</span> {o.message}
                      </p>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}
            <Button type="button" variant="outline" onClick={resetToIdle}>
              Importar outra planilha
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

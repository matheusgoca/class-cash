import * as XLSX from 'xlsx';
import { ImportEntityKey } from './types';

interface TemplateDef {
  fileName: string;
  dataSheetName: string;
  headers: string[];
  example: (string | number)[];
  instructionRows: (string | number)[][];
}

const TEMPLATES: Record<ImportEntityKey, TemplateDef> = {
  classes: {
    fileName: 'modelo-turmas.xlsx',
    dataSheetName: 'Dados',
    headers: ['nome', 'serie_ano', 'descricao', 'capacidade_maxima', 'mensalidade_turma', 'professor_email', 'cor'],
    example: ['5º Ano A', '5º Ano', 'Turma da manhã', 30, '650,00', 'professor@escola.com', '#3B82F6'],
    instructionRows: [
      ['Coluna', 'Obrigatório', 'Formato', 'Observação'],
      ['nome', 'Sim', 'Texto', 'Precisa ser único — não pode repetir o nome de outra turma'],
      ['serie_ano', 'Não', 'Texto', 'Ex: "5º Ano"'],
      ['descricao', 'Não', 'Texto', ''],
      ['capacidade_maxima', 'Não', 'Número inteiro', 'Se vazio, assume 30'],
      ['mensalidade_turma', 'Não', 'Moeda (R$)', 'Use vírgula como separador decimal. Ex: 650,00'],
      ['professor_email', 'Não', 'Texto', 'E-mail de professor(es) JÁ CADASTRADO(S). Vários: separe por vírgula. Importe a planilha de Professores antes desta.'],
      ['cor', 'Não', 'Texto (hex)', 'Ex: #3B82F6. Se vazio, uma cor é escolhida automaticamente'],
    ],
  },
  teachers: {
    fileName: 'modelo-professores.xlsx',
    dataSheetName: 'Dados',
    headers: ['nome_completo', 'email', 'telefone', 'salario', 'status'],
    example: ['Maria Souza', 'maria.souza@escola.com', '(11) 99999-9999', '3000,00', 'ativo'],
    instructionRows: [
      ['Coluna', 'Obrigatório', 'Formato', 'Observação'],
      ['nome_completo', 'Sim', 'Texto', ''],
      ['email', 'Sim', 'E-mail', 'Precisa ser único em toda a plataforma (não só nesta escola)'],
      ['telefone', 'Não', 'Texto', 'Ex: (11) 99999-9999'],
      ['salario', 'Não', 'Moeda (R$)', 'Use vírgula como separador decimal. Ex: 3000,00'],
      ['status', 'Não', '"ativo" ou "inativo"', 'Se vazio, assume "ativo"'],
    ],
  },
  students: {
    fileName: 'modelo-alunos.xlsx',
    dataSheetName: 'Dados',
    headers: ['nome_completo', 'data_nascimento', 'data_matricula', 'email', 'telefone', 'responsavel', 'turma', 'status'],
    example: ['João da Silva', '15/03/2015', '01/02/2026', 'joao.responsavel@email.com', '(11) 98888-8888', 'Ana da Silva - (11) 97777-7777', '5º Ano A', 'ativo'],
    instructionRows: [
      ['Coluna', 'Obrigatório', 'Formato', 'Observação'],
      ['nome_completo', 'Sim', 'Texto', ''],
      ['data_nascimento', 'Sim', 'Data (DD/MM/AAAA)', ''],
      ['data_matricula', 'Não', 'Data (DD/MM/AAAA)', 'Se vazio, assume a data de hoje'],
      ['email', 'Não', 'E-mail', ''],
      ['telefone', 'Não', 'Texto', 'Ex: (11) 99999-9999'],
      ['responsavel', 'Não', 'Texto', 'Nome e contato do responsável'],
      ['turma', 'Não', 'Texto', 'Nome EXATO de uma turma já cadastrada. Importe a planilha de Turmas antes desta.'],
      ['status', 'Não', '"ativo" ou "inativo"', 'Se vazio, assume "ativo"'],
    ],
  },
  contracts: {
    fileName: 'modelo-matriculas.xlsx',
    dataSheetName: 'Dados',
    headers: ['aluno', 'aluno_email', 'turma', 'valor_mensalidade', 'desconto_percentual', 'dia_vencimento', 'data_inicio', 'data_fim', 'status', 'gerar_mensalidades'],
    example: ['João da Silva', 'joao.responsavel@email.com', '5º Ano A', '650,00', '10', '10', '01/02/2026', '', 'ativo', 'sim'],
    instructionRows: [
      ['Coluna', 'Obrigatório', 'Formato', 'Observação'],
      ['aluno', 'Sim', 'Texto', 'Nome EXATO de um aluno já cadastrado. Importe a planilha de Alunos antes desta.'],
      ['aluno_email', 'Não', 'E-mail', 'Preencha se houver mais de um aluno com o mesmo nome, para desempatar'],
      ['turma', 'Não', 'Texto', 'Nome EXATO de uma turma já cadastrada'],
      ['valor_mensalidade', 'Sim', 'Moeda (R$)', 'Use vírgula como separador decimal. Ex: 650,00'],
      ['desconto_percentual', 'Não', 'Número de 0 a 100', 'Se vazio, assume 0'],
      ['dia_vencimento', 'Não', 'Número de 1 a 28', 'Se vazio, assume 10'],
      ['data_inicio', 'Sim', 'Data (DD/MM/AAAA)', ''],
      ['data_fim', 'Não', 'Data (DD/MM/AAAA)', 'Se vazio, assume 12 meses após o início'],
      ['status', 'Não', '"ativo", "suspenso" ou "cancelado"', 'Se vazio, assume "ativo"'],
      ['gerar_mensalidades', 'Não', '"sim" ou "não"', 'Se "sim" e status "ativo", as mensalidades mensais são geradas automaticamente (igual ao fluxo manual). Se vazio, assume "sim"'],
    ],
  },
};

function buildWorkbook(def: TemplateDef): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const instructionsAoA: (string | number)[][] = [
    [`Modelo de importação — ${def.dataSheetName === 'Dados' ? '' : ''}`.trim()],
    [],
    ...def.instructionRows,
    [],
    ['Antes de preencher: apague a linha de exemplo (linha 2) na aba "Dados".'],
    ['Depois de preencher: salve o arquivo e envie na tela de Importação em Configurações.'],
  ];
  const instructionsSheet = XLSX.utils.aoa_to_sheet(instructionsAoA);
  instructionsSheet['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 28 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, instructionsSheet, 'Instruções');

  const dataSheet = XLSX.utils.aoa_to_sheet([def.headers, def.example]);
  dataSheet['!cols'] = def.headers.map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(wb, dataSheet, def.dataSheetName);

  return wb;
}

export function downloadImportTemplate(entity: ImportEntityKey): void {
  const def = TEMPLATES[entity];
  const wb = buildWorkbook(def);
  XLSX.writeFile(wb, def.fileName);
}

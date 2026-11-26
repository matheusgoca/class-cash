import {
  ImportContext,
  ImportRowError,
  ImportRowNote,
  ImportValidationResult,
  ValidatedClassRow,
  ValidatedContractRow,
  ValidatedStudentRow,
  ValidatedTeacherRow,
} from './types';
import {
  normalizeEmail,
  normalizeEnumWord,
  normalizeText,
  parseCurrencyBR,
  parseDateBR,
  parseIntSafe,
  randomClassColor,
  resolveClassFee,
  splitEmails,
  toISODate,
} from './shared';
import { formatCurrency } from '@/lib/calculations';
import { findOverlap } from '@/lib/contractOverlap';

// Every validator gets the raw parsed rows (Record<string,string>, one per
// spreadsheet row) plus the current ImportContext (already-existing records
// in this school, so cross-references and duplicate checks work without a
// round trip per row). Row numbers are 1-based and match what the user sees
// in Excel: row 1 is the header, so the first data row is row 2.

export function validateClassesRows(
  rows: Record<string, string>[],
  context: ImportContext
): ImportValidationResult<ValidatedClassRow> {
  const errors: ImportRowError[] = [];
  const valid: Array<{ row: number; data: ValidatedClassRow }> = [];

  const existingNames = new Set(context.existingClasses.map((c) => c.name.trim().toLowerCase()));
  const namesInFile = new Set<string>();

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const name = normalizeText(row['nome']);

    if (!name) {
      errors.push({ row: rowNum, field: 'nome', message: 'Nome da turma é obrigatório.' });
      return;
    }
    const key = name.toLowerCase();
    if (existingNames.has(key)) {
      errors.push({ row: rowNum, field: 'nome', message: `Já existe uma turma chamada "${name}" nesta escola.` });
      return;
    }
    if (namesInFile.has(key)) {
      errors.push({ row: rowNum, field: 'nome', message: `Nome de turma "${name}" repetido em outra linha desta planilha.` });
      return;
    }

    const maxCapacityRaw = row['capacidade_maxima'];
    const maxCapacity = maxCapacityRaw ? parseIntSafe(maxCapacityRaw) : 30;
    if (maxCapacity === undefined || maxCapacity < 1) {
      errors.push({ row: rowNum, field: 'capacidade_maxima', message: 'Capacidade máxima precisa ser um número inteiro maior que 0.' });
      return;
    }

    const monthlyFeeRaw = row['mensalidade_turma'];
    const monthlyFee = monthlyFeeRaw ? parseCurrencyBR(monthlyFeeRaw) : undefined;
    if (monthlyFeeRaw && monthlyFee === undefined) {
      errors.push({ row: rowNum, field: 'mensalidade_turma', message: `Valor de mensalidade inválido: "${monthlyFeeRaw}".` });
      return;
    }

    const teacherIds: string[] = [];
    let teacherLookupFailed = false;
    if (row['professor_email']) {
      for (const email of splitEmails(row['professor_email'])) {
        const teacher = context.existingTeachers.find((t) => t.email.toLowerCase() === email);
        if (!teacher) {
          errors.push({ row: rowNum, field: 'professor_email', message: `Professor com e-mail "${email}" não encontrado. Importe a planilha de Professores antes desta.` });
          teacherLookupFailed = true;
          break;
        }
        teacherIds.push(teacher.id);
      }
    }
    if (teacherLookupFailed) return;

    namesInFile.add(key);
    valid.push({
      row: rowNum,
      data: {
        name,
        grade: normalizeText(row['serie_ano']) || null,
        description: normalizeText(row['descricao']) || null,
        max_capacity: maxCapacity,
        monthly_fee: monthlyFee ?? null,
        // Offset pela quantidade de turmas já existentes — sem isso, toda
        // sessão de import começava a paleta do zero e repetia as mesmas
        // cores de uma importação anterior.
        color: normalizeText(row['cor']) || randomClassColor(context.existingClasses.length + idx),
        teacher_ids: teacherIds,
      },
    });
  });

  return { valid, errors, totalRows: rows.length };
}

export function validateTeachersRows(
  rows: Record<string, string>[],
  context: ImportContext & { existingTeacherEmails?: Set<string> }
): ImportValidationResult<ValidatedTeacherRow> {
  const errors: ImportRowError[] = [];
  const valid: Array<{ row: number; data: ValidatedTeacherRow }> = [];

  const existingEmails = new Set(context.existingTeachers.map((t) => t.email.toLowerCase()));
  const emailsInFile = new Set<string>();

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const fullName = normalizeText(row['nome_completo']);
    const email = normalizeEmail(row['email']);

    if (!fullName) {
      errors.push({ row: rowNum, field: 'nome_completo', message: 'Nome completo é obrigatório.' });
      return;
    }
    if (!email || !email.includes('@')) {
      errors.push({ row: rowNum, field: 'email', message: 'E-mail é obrigatório e precisa ser válido.' });
      return;
    }
    if (existingEmails.has(email)) {
      errors.push({ row: rowNum, field: 'email', message: `Já existe um professor com o e-mail "${email}" (nesta escola ou em outra — o e-mail precisa ser único em toda a plataforma).` });
      return;
    }
    if (emailsInFile.has(email)) {
      errors.push({ row: rowNum, field: 'email', message: `E-mail "${email}" repetido em outra linha desta planilha.` });
      return;
    }

    const salaryRaw = row['salario'];
    const salary = salaryRaw ? parseCurrencyBR(salaryRaw) : undefined;
    if (salaryRaw && salary === undefined) {
      errors.push({ row: rowNum, field: 'salario', message: `Salário inválido: "${salaryRaw}".` });
      return;
    }

    const status = normalizeEnumWord(row['status'], 'active');
    if (status !== 'active' && status !== 'inactive') {
      errors.push({ row: rowNum, field: 'status', message: `Status inválido: "${row['status']}". Use "ativo" ou "inativo".` });
      return;
    }

    emailsInFile.add(email);
    valid.push({
      row: rowNum,
      data: {
        full_name: fullName,
        email,
        phone: normalizeText(row['telefone']) || null,
        salary: salary ?? null,
        status: status as 'active' | 'inactive',
      },
    });
  });

  return { valid, errors, totalRows: rows.length };
}

export function validateStudentsRows(
  rows: Record<string, string>[],
  context: ImportContext
): ImportValidationResult<ValidatedStudentRow> {
  const errors: ImportRowError[] = [];
  const valid: Array<{ row: number; data: ValidatedStudentRow }> = [];

  // Mesmo nome + mesma data de nascimento já cadastrado (ou repetido na
  // própria planilha) quase certamente é reenvio do mesmo aluno — sem essa
  // checagem, reenviar a planilha (ex: depois de corrigir uma linha com
  // erro) duplicava todo mundo que já tinha sido importado com sucesso.
  const existingKeys = new Set(
    context.existingStudents.map((s: any) => `${s.full_name.trim().toLowerCase()}|${s.birth_date ?? ''}`)
  );
  const keysInFile = new Set<string>();

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const fullName = normalizeText(row['nome_completo']);

    if (!fullName) {
      errors.push({ row: rowNum, field: 'nome_completo', message: 'Nome completo é obrigatório.' });
      return;
    }

    const birthDateRaw = row['data_nascimento'];
    const birthDate = parseDateBR(birthDateRaw);
    if (!birthDate) {
      errors.push({ row: rowNum, field: 'data_nascimento', message: `Data de nascimento obrigatória e precisa estar no formato DD/MM/AAAA (recebido: "${birthDateRaw}").` });
      return;
    }

    const dedupKey = `${fullName.toLowerCase()}|${toISODate(birthDate)}`;
    if (existingKeys.has(dedupKey)) {
      errors.push({ row: rowNum, field: 'nome_completo', message: `Já existe um aluno "${fullName}" com essa mesma data de nascimento nesta escola.` });
      return;
    }
    if (keysInFile.has(dedupKey)) {
      errors.push({ row: rowNum, field: 'nome_completo', message: `Aluno "${fullName}" (mesma data de nascimento) repetido em outra linha desta planilha.` });
      return;
    }

    const enrollmentDateRaw = row['data_matricula'];
    const enrollmentDate = enrollmentDateRaw ? parseDateBR(enrollmentDateRaw) : new Date();
    if (!enrollmentDate) {
      errors.push({ row: rowNum, field: 'data_matricula', message: `Data de matrícula inválida (recebido: "${enrollmentDateRaw}"). Use o formato DD/MM/AAAA ou deixe em branco.` });
      return;
    }

    const email = normalizeText(row['email']);
    if (email && !email.includes('@')) {
      errors.push({ row: rowNum, field: 'email', message: `E-mail inválido: "${email}".` });
      return;
    }

    const status = normalizeEnumWord(row['status'], 'active');
    if (status !== 'active' && status !== 'inactive') {
      errors.push({ row: rowNum, field: 'status', message: `Status inválido: "${row['status']}". Use "ativo" ou "inativo".` });
      return;
    }

    let classId: string | null = null;
    const className = normalizeText(row['turma']);
    if (className) {
      const found = context.existingClasses.find((c) => c.name.trim().toLowerCase() === className.toLowerCase());
      if (!found) {
        errors.push({ row: rowNum, field: 'turma', message: `Turma "${className}" não encontrada. Importe a planilha de Turmas antes desta, ou deixe em branco.` });
        return;
      }
      classId = found.id;
    }

    keysInFile.add(dedupKey);
    valid.push({
      row: rowNum,
      data: {
        full_name: fullName,
        birth_date: toISODate(birthDate),
        enrollment_date: toISODate(enrollmentDate),
        email: email || null,
        phone: normalizeText(row['telefone']) || null,
        guardian_contact: normalizeText(row['responsavel']) || null,
        status: status as 'active' | 'inactive',
        class_id: classId,
      },
    });
  });

  return { valid, errors, totalRows: rows.length };
}

export function validateContractsRows(
  rows: Record<string, string>[],
  context: ImportContext
): ImportValidationResult<ValidatedContractRow> {
  const errors: ImportRowError[] = [];
  const notes: ImportRowNote[] = [];
  const valid: Array<{ row: number; data: ValidatedContractRow }> = [];
  // Alunos já usados nesta planilha — sem isso, duas linhas pro mesmo aluno
  // (ex: reenviar o arquivo depois de corrigir uma linha) criavam dois
  // contratos ativos, e generateTuitions rodava pros dois — cobrança em dobro.
  // Bloco C2: contratos ATIVOS já aceitos neste arquivo (aluno + período + linha), para a trava de sobreposição entre linhas.
  const activeInFile: Array<{ student_id: string; start_date: string; end_date: string; status: string; row: number }> = [];

  rows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const studentName = normalizeText(row['aluno']);
    const studentEmail = normalizeEmail(row['aluno_email']);

    if (!studentName) {
      errors.push({ row: rowNum, field: 'aluno', message: 'Nome do aluno é obrigatório.' });
      return;
    }

    const nameMatches = context.existingStudents.filter(
      (s) => s.full_name.trim().toLowerCase() === studentName.toLowerCase()
    );
    let student = nameMatches[0];
    if (nameMatches.length === 0) {
      errors.push({ row: rowNum, field: 'aluno', message: `Aluno "${studentName}" não encontrado. Importe a planilha de Alunos antes desta.` });
      return;
    }
    if (nameMatches.length > 1) {
      if (!studentEmail) {
        errors.push({ row: rowNum, field: 'aluno', message: `Há ${nameMatches.length} alunos chamados "${studentName}". Preencha "aluno_email" para identificar qual deles.` });
        return;
      }
      const disambiguated = nameMatches.find((s) => (s.email ?? '').toLowerCase() === studentEmail);
      if (!disambiguated) {
        errors.push({ row: rowNum, field: 'aluno_email', message: `Nenhum aluno chamado "${studentName}" tem o e-mail "${studentEmail}".` });
        return;
      }
      student = disambiguated;
    }


    // Turma primeiro: o fallback do valor depende dela.
    let classId: string | null = null;
    let selectedClass: ImportContext['existingClasses'][number] | undefined;
    const className = normalizeText(row['turma']);
    if (className) {
      const found = context.existingClasses.find((c) => c.name.trim().toLowerCase() === className.toLowerCase());
      if (!found) {
        errors.push({ row: rowNum, field: 'turma', message: `Turma "${className}" não encontrada. Importe a planilha de Turmas antes desta, ou deixe em branco.` });
        return;
      }
      classId = found.id;
      selectedClass = found;
    }

    // Item I: valor_mensalidade é opcional. Informado: vale o informado (valor negociado).
    // Vazio: o fallback para a turma SÓ vale quando ela tem APENAS o valor de meio período; senão a linha tem erro e não é importada.
    const monthlyAmountRaw = row['valor_mensalidade'];
    let monthlyAmount: number | undefined;
    if (String(monthlyAmountRaw ?? '').trim() === '') {
      if (!selectedClass) {
        errors.push({ row: rowNum, field: 'valor_mensalidade', message: 'Informe "valor_mensalidade" ou escolha uma turma que tenha mensalidade cadastrada.' });
        return;
      }
      const fee = resolveClassFee(selectedClass);
      if (fee.kind === 'none') {
        errors.push({ row: rowNum, field: 'valor_mensalidade', message: `A turma "${selectedClass.name}" não tem mensalidade cadastrada. Informe "valor_mensalidade".` });
        return;
      }
      if (fee.kind === 'integral_only') {
        errors.push({
          row: rowNum,
          field: 'valor_mensalidade',
          message: `A turma "${selectedClass.name}" só tem valor integral (${formatCurrency(fee.full)}) e a planilha não diz o período do contrato, então o valor da turma não é usado. Informe "valor_mensalidade".`,
        });
        return;
      }
      if (fee.kind === 'both') {
        errors.push({
          row: rowNum,
          field: 'valor_mensalidade',
          message: `A turma "${selectedClass.name}" tem dois valores (meio período ${formatCurrency(fee.half)} e integral ${formatCurrency(fee.full)}) e a planilha não diz qual período o contrato tem. Informe "valor_mensalidade".`,
        });
        return;
      }
      monthlyAmount = fee.amount;
      notes.push({ row: rowNum, field: 'valor_mensalidade', message: `Valor da turma "${selectedClass.name}" usado (${fee.period}): ${formatCurrency(fee.amount)}.` });
    } else {
      monthlyAmount = parseCurrencyBR(monthlyAmountRaw);
      if (monthlyAmount === undefined) {
        errors.push({ row: rowNum, field: 'valor_mensalidade', message: `Valor da mensalidade precisa ser um número (recebido: "${monthlyAmountRaw}").` });
        return;
      }
    }

    if (monthlyAmount <= 0) {
      errors.push({ row: rowNum, field: 'valor_mensalidade', message: 'O valor da mensalidade precisa ser maior que zero. Para bolsa integral use desconto de 100% (coluna desconto_percentual); o valor de tabela fica registrado.' });
      return;
    }

    const discountRaw = row['desconto_percentual'];
    const discount = discountRaw ? parseCurrencyBR(discountRaw) : 0;
    if (discount === undefined || discount < 0 || discount > 100) {
      errors.push({ row: rowNum, field: 'desconto_percentual', message: `Desconto precisa ser um número entre 0 e 100 (recebido: "${discountRaw}").` });
      return;
    }

    const dueDayRaw = row['dia_vencimento'];
    const dueDay = dueDayRaw ? parseIntSafe(dueDayRaw) : 10;
    if (dueDay === undefined || dueDay < 1 || dueDay > 28) {
      errors.push({ row: rowNum, field: 'dia_vencimento', message: `Dia de vencimento precisa ser um número entre 1 e 28 (recebido: "${dueDayRaw}").` });
      return;
    }

    const startDateRaw = row['data_inicio'];
    const startDate = parseDateBR(startDateRaw);
    if (!startDate) {
      errors.push({ row: rowNum, field: 'data_inicio', message: `Data de início é obrigatória e precisa estar no formato DD/MM/AAAA (recebido: "${startDateRaw}").` });
      return;
    }

    const endDateRaw = row['data_fim'];
    const endDate = endDateRaw
      ? parseDateBR(endDateRaw)
      : new Date(startDate.getFullYear(), startDate.getMonth() + 12, 0);
    if (!endDate) {
      errors.push({ row: rowNum, field: 'data_fim', message: `Data de término inválida (recebido: "${endDateRaw}"). Use o formato DD/MM/AAAA ou deixe em branco.` });
      return;
    }

    const status = normalizeEnumWord(row['status'], 'active');
    if (!['active', 'suspended', 'cancelled'].includes(status)) {
      errors.push({ row: rowNum, field: 'status', message: `Status inválido: "${row['status']}". Use "ativo", "suspenso" ou "cancelado".` });
      return;
    }

    const generateTuitionsWord = normalizeEnumWord(row['gerar_mensalidades'], 'yes');
    if (!['yes', 'no'].includes(generateTuitionsWord)) {
      errors.push({ row: rowNum, field: 'gerar_mensalidades', message: `Valor inválido em "gerar_mensalidades": "${row['gerar_mensalidades']}". Use "sim" ou "não".` });
      return;
    }

    if (endDate < startDate) {
      errors.push({ row: rowNum, field: 'data_fim', message: 'A data de término não pode ser anterior à data de início.' });
      return;
    }

    // Bloco C2: só contrato ATIVO cobra, então só ele é barrado quando se sobrepõe a outro ativo do mesmo aluno
    // (já existente na escola ou aceito antes neste arquivo). Períodos seguidos (renovação) entram.
    if (status === 'active') {
      const cand = { student_id: student.id, start_date: toISODate(startDate), end_date: toISODate(endDate) };
      const clash = findOverlap(context.existingActiveContracts, cand);
      if (clash) {
        const d = (iso: string) => iso.split('-').reverse().join('/');
        errors.push({ row: rowNum, field: 'aluno', message: `"${studentName}" já tem um contrato ativo de ${d(clash.start_date)} a ${d(clash.end_date)} que se sobrepõe a este período. Encerre ou ajuste o contrato atual antes de importar outro.` });
        return;
      }
      const inFile = findOverlap(activeInFile, cand);
      if (inFile) {
        errors.push({ row: rowNum, field: 'aluno', message: `"${studentName}" aparece em outra linha desta planilha (linha ${(inFile as { row?: number }).row}) com período que se sobrepõe a este.` });
        return;
      }
      activeInFile.push({ ...cand, status: 'active', row: rowNum });
    }

    valid.push({
      row: rowNum,
      data: {
        student_id: student.id,
        class_id: classId,
        monthly_amount: monthlyAmount,
        discount,
        due_day: dueDay,
        start_date: toISODate(startDate),
        end_date: toISODate(endDate),
        status: status as 'active' | 'suspended' | 'cancelled',
        generate_tuitions: generateTuitionsWord === 'yes',
      },
    });
  });

  return { valid, errors, notes, totalRows: rows.length };
}

-- ================================================================
-- students.class_id nunca foi escrito pelo formulário de Aluno (que
-- sempre edita enrollments.class_id) — ficava sempre NULL, e o filtro
-- de turma na lista de Alunos checava as duas colunas, sendo que uma
-- delas nunca tinha valor. Três "fontes de verdade" pra turma do aluno
-- (students.class_id, enrollments.class_id, contracts.class_id) viram
-- uma: enrollments é a real.
-- ================================================================

ALTER TABLE public.students DROP COLUMN class_id;

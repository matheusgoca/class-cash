-- Fix and ensure all foreign key relationships with CASCADE behavior

-- First, drop existing foreign keys if they exist (to recreate with proper CASCADE)
ALTER TABLE IF EXISTS public.contracts 
  DROP CONSTRAINT IF EXISTS contracts_student_id_fkey,
  DROP CONSTRAINT IF EXISTS contracts_class_id_fkey;

ALTER TABLE IF EXISTS public.tuitions 
  DROP CONSTRAINT IF EXISTS tuitions_contract_id_fkey,
  DROP CONSTRAINT IF EXISTS tuitions_student_id_fkey;

ALTER TABLE IF EXISTS public.payments 
  DROP CONSTRAINT IF EXISTS payments_enrollment_id_fkey;

ALTER TABLE IF EXISTS public.enrollments
  DROP CONSTRAINT IF EXISTS enrollments_student_id_fkey,
  DROP CONSTRAINT IF EXISTS enrollments_class_id_fkey;

ALTER TABLE IF EXISTS public.class_teachers
  DROP CONSTRAINT IF EXISTS class_teachers_class_id_fkey,
  DROP CONSTRAINT IF EXISTS class_teachers_teacher_id_fkey;

ALTER TABLE IF EXISTS public.classes
  DROP CONSTRAINT IF EXISTS classes_teacher_id_fkey;

-- Now recreate all foreign keys with proper CASCADE behavior

-- contracts table foreign keys
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_student_id_fkey 
    FOREIGN KEY (student_id) 
    REFERENCES public.students(id) 
    ON DELETE CASCADE;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_class_id_fkey 
    FOREIGN KEY (class_id) 
    REFERENCES public.classes(id) 
    ON DELETE CASCADE;

-- tuitions table foreign keys
ALTER TABLE public.tuitions
  ADD CONSTRAINT tuitions_contract_id_fkey 
    FOREIGN KEY (contract_id) 
    REFERENCES public.contracts(id) 
    ON DELETE CASCADE;

ALTER TABLE public.tuitions
  ADD CONSTRAINT tuitions_student_id_fkey 
    FOREIGN KEY (student_id) 
    REFERENCES public.students(id) 
    ON DELETE CASCADE;

-- payments table foreign keys
ALTER TABLE public.payments
  ADD CONSTRAINT payments_enrollment_id_fkey 
    FOREIGN KEY (enrollment_id) 
    REFERENCES public.enrollments(id) 
    ON DELETE CASCADE;

-- enrollments table foreign keys
ALTER TABLE public.enrollments
  ADD CONSTRAINT enrollments_student_id_fkey 
    FOREIGN KEY (student_id) 
    REFERENCES public.students(id) 
    ON DELETE CASCADE;

ALTER TABLE public.enrollments
  ADD CONSTRAINT enrollments_class_id_fkey 
    FOREIGN KEY (class_id) 
    REFERENCES public.classes(id) 
    ON DELETE CASCADE;

-- class_teachers table foreign keys
ALTER TABLE public.class_teachers
  ADD CONSTRAINT class_teachers_class_id_fkey 
    FOREIGN KEY (class_id) 
    REFERENCES public.classes(id) 
    ON DELETE CASCADE;

ALTER TABLE public.class_teachers
  ADD CONSTRAINT class_teachers_teacher_id_fkey 
    FOREIGN KEY (teacher_id) 
    REFERENCES public.teachers(id) 
    ON DELETE CASCADE;

-- classes table foreign key
ALTER TABLE public.classes
  ADD CONSTRAINT classes_teacher_id_fkey 
    FOREIGN KEY (teacher_id) 
    REFERENCES public.teachers(id) 
    ON DELETE SET NULL;

-- profiles and user_roles already have proper foreign keys to auth.users
-- but let's ensure they have CASCADE behavior

ALTER TABLE IF EXISTS public.profiles 
  DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES auth.users(id) 
    ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.user_roles 
  DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;

ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES auth.users(id) 
    ON DELETE CASCADE;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
-- Drop all policies that depend on the function
DROP POLICY IF EXISTS "Admin and financial can manage teachers" ON public.teachers;
DROP POLICY IF EXISTS "Teachers can view teachers" ON public.teachers;
DROP POLICY IF EXISTS "Admin and financial can manage classes" ON public.classes;
DROP POLICY IF EXISTS "Teachers can view classes" ON public.classes;
DROP POLICY IF EXISTS "Admin and financial can manage students" ON public.students;
DROP POLICY IF EXISTS "Teachers can view students" ON public.students;
DROP POLICY IF EXISTS "Admin and financial can manage tuitions" ON public.tuitions;
DROP POLICY IF EXISTS "Teachers can view tuitions" ON public.tuitions;

-- Drop and recreate the function with proper security settings
DROP FUNCTION IF EXISTS public.get_current_user_role();

CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT 
LANGUAGE SQL 
SECURITY DEFINER 
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid();
$$;

-- Recreate all the policies
CREATE POLICY "Admin and financial can manage teachers" 
ON public.teachers FOR ALL 
USING (public.get_current_user_role() IN ('admin', 'financial'));

CREATE POLICY "Teachers can view teachers" 
ON public.teachers FOR SELECT 
USING (public.get_current_user_role() = 'teacher');

CREATE POLICY "Admin and financial can manage classes" 
ON public.classes FOR ALL 
USING (public.get_current_user_role() IN ('admin', 'financial'));

CREATE POLICY "Teachers can view classes" 
ON public.classes FOR SELECT 
USING (public.get_current_user_role() = 'teacher');

CREATE POLICY "Admin and financial can manage students" 
ON public.students FOR ALL 
USING (public.get_current_user_role() IN ('admin', 'financial'));

CREATE POLICY "Teachers can view students" 
ON public.students FOR SELECT 
USING (public.get_current_user_role() = 'teacher');

CREATE POLICY "Admin and financial can manage tuitions" 
ON public.tuitions FOR ALL 
USING (public.get_current_user_role() IN ('admin', 'financial'));

CREATE POLICY "Teachers can view tuitions" 
ON public.tuitions FOR SELECT 
USING (public.get_current_user_role() = 'teacher');
-- ================================================================
-- CRITICAL SECURITY FIXES
-- ================================================================
-- This migration addresses critical security vulnerabilities:
-- 1. Privilege escalation via roles in profiles table
-- 2. Missing RLS on sensitive tables
-- 3. Server-side input validation constraints
-- ================================================================

-- ================================================================
-- PART 1: CREATE SECURE USER ROLES SYSTEM
-- ================================================================

-- Create app_role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'financial', 'teacher');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Only admins can manage roles
CREATE POLICY "Only admins can manage user roles"
  ON public.user_roles
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- Users can view their own roles
CREATE POLICY "Users can view their own roles"
  ON public.user_roles
  FOR SELECT
  USING (user_id = auth.uid());

-- Create SECURITY DEFINER function to check roles safely
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create helper function to get user role (returns first role, prioritizing admin)
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY 
    CASE role
      WHEN 'admin' THEN 1
      WHEN 'financial' THEN 2
      WHEN 'teacher' THEN 3
    END
  LIMIT 1
$$;

-- Migrate existing roles from profiles to user_roles
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, role::app_role
FROM public.profiles
WHERE role IN ('admin', 'financial', 'teacher')
ON CONFLICT (user_id, role) DO NOTHING;

-- Update get_current_user_role function to use new table
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_user_role(auth.uid())
$$;

-- ================================================================
-- PART 2: ENABLE RLS ON ALL SENSITIVE TABLES
-- ================================================================

-- STUDENTS TABLE
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view students"
  ON public.students
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND
    public.get_current_user_role() IN ('admin', 'financial', 'teacher')
  );

CREATE POLICY "Admin and financial can insert students"
  ON public.students
  FOR INSERT
  WITH CHECK (
    public.get_current_user_role() IN ('admin', 'financial')
  );

CREATE POLICY "Admin and financial can update students"
  ON public.students
  FOR UPDATE
  USING (
    public.get_current_user_role() IN ('admin', 'financial')
  );

CREATE POLICY "Admin and financial can delete students"
  ON public.students
  FOR DELETE
  USING (
    public.get_current_user_role() IN ('admin', 'financial')
  );

-- TEACHERS TABLE
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view teachers"
  ON public.teachers
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND
    public.get_current_user_role() IN ('admin', 'financial', 'teacher')
  );

CREATE POLICY "Admin can manage teachers"
  ON public.teachers
  FOR ALL
  USING (
    public.get_current_user_role() = 'admin'
  );

-- PAYMENTS TABLE
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and financial can view payments"
  ON public.payments
  FOR SELECT
  USING (
    public.get_current_user_role() IN ('admin', 'financial')
  );

CREATE POLICY "Admin and financial can manage payments"
  ON public.payments
  FOR ALL
  USING (
    public.get_current_user_role() IN ('admin', 'financial')
  );

-- ENROLLMENTS TABLE
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view enrollments"
  ON public.enrollments
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND
    public.get_current_user_role() IN ('admin', 'financial', 'teacher')
  );

CREATE POLICY "Admin and financial can manage enrollments"
  ON public.enrollments
  FOR ALL
  USING (
    public.get_current_user_role() IN ('admin', 'financial')
  );

-- CLASSES TABLE
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view classes"
  ON public.classes
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND
    public.get_current_user_role() IN ('admin', 'financial', 'teacher')
  );

CREATE POLICY "Admin can manage classes"
  ON public.classes
  FOR ALL
  USING (
    public.get_current_user_role() = 'admin'
  );

-- CLASS_TEACHERS TABLE
ALTER TABLE public.class_teachers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view class_teachers"
  ON public.class_teachers
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND
    public.get_current_user_role() IN ('admin', 'financial', 'teacher')
  );

CREATE POLICY "Admin can manage class_teachers"
  ON public.class_teachers
  FOR ALL
  USING (
    public.get_current_user_role() = 'admin'
  );

-- ================================================================
-- PART 3: ADD SERVER-SIDE INPUT VALIDATION CONSTRAINTS
-- ================================================================

-- CONTRACTS TABLE CONSTRAINTS
ALTER TABLE public.contracts 
  ADD CONSTRAINT check_contract_dates CHECK (end_date > start_date);

ALTER TABLE public.contracts 
  ADD CONSTRAINT check_monthly_amount_positive CHECK (monthly_amount > 0);

ALTER TABLE public.contracts 
  ADD CONSTRAINT check_discount_range CHECK (discount >= 0 AND discount <= 100);

-- TUITIONS TABLE CONSTRAINTS
ALTER TABLE public.tuitions 
  ADD CONSTRAINT check_tuition_amount_positive CHECK (amount > 0);

ALTER TABLE public.tuitions 
  ADD CONSTRAINT check_tuition_discount_range CHECK (discount_applied >= 0);

ALTER TABLE public.tuitions 
  ADD CONSTRAINT check_tuition_penalty_range CHECK (penalty_amount >= 0);

-- TEACHERS TABLE CONSTRAINTS
ALTER TABLE public.teachers 
  ADD CONSTRAINT check_teacher_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

ALTER TABLE public.teachers 
  ADD CONSTRAINT teachers_email_unique UNIQUE (email);

-- ================================================================
-- PART 4: UPDATE PROFILES TABLE RLS
-- ================================================================

-- Drop existing profile update policy that allows role modification
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

-- Create new policy that prevents role modification
CREATE POLICY "Users can update their own profile (except role)"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id AND
    (role = (SELECT role FROM public.profiles WHERE user_id = auth.uid()))
  );

-- ================================================================
-- PART 5: UPDATE handle_new_user TRIGGER FUNCTION
-- ================================================================

-- Update the function to assign default teacher role in user_roles table
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert into profiles (keeping role for backward compatibility during migration)
  INSERT INTO public.profiles (user_id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    NEW.email,
    'teacher'
  );
  
  -- Insert into user_roles (new secure method)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'teacher'::app_role);
  
  RETURN NEW;
END;
$$;
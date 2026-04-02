-- Fix recursive RLS on user_roles using SECURITY DEFINER helper
-- 1) Replace recursive policy with safe has_role-based policy
DROP POLICY IF EXISTS "Only admins can manage user roles" ON public.user_roles;
CREATE POLICY "Only admins can manage user roles"
ON public.user_roles
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) Remove duplicate role storage from profiles and adjust policies
-- Drop old update policy that referenced the removed column
DROP POLICY IF EXISTS "Users can update their own profile (except role)" ON public.profiles;
-- Drop role column from profiles
ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;
-- Create simplified update policy (users can update their own profile)
CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 3) Update handle_new_user trigger function to stop writing profiles.role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert into profiles without role
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    NEW.email
  );
  
  -- Ensure new users get a default role entry in user_roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'teacher'::app_role);
  
  RETURN NEW;
END;
$$;

-- 4) Add server-side data integrity constraints
-- Contracts: amounts non-negative, discount in range, and end_date after start_date
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_monthly_amount_nonneg CHECK (monthly_amount >= 0),
  ADD CONSTRAINT contracts_discount_between_0_100 CHECK (discount >= 0 AND discount <= 100),
  ADD CONSTRAINT contracts_end_after_start CHECK (end_date > start_date);

-- Tuitions: monetary fields non-negative
ALTER TABLE public.tuitions
  ADD CONSTRAINT tuitions_amount_nonneg CHECK (amount >= 0),
  ADD CONSTRAINT tuitions_final_amount_nonneg CHECK (final_amount >= 0),
  ADD CONSTRAINT tuitions_discount_applied_nonneg CHECK (discount_applied >= 0),
  ADD CONSTRAINT tuitions_penalty_amount_nonneg CHECK (penalty_amount >= 0);

-- Payments: amount non-negative
ALTER TABLE public.payments
  ADD CONSTRAINT payments_amount_nonneg CHECK (amount >= 0);

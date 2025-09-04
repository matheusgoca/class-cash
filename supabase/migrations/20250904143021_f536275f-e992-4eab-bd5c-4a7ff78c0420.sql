-- Fix remaining function search paths for security
CREATE OR REPLACE FUNCTION public.calculate_final_tuition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Calculate final tuition value based on full value and discount
  IF NEW.full_tuition_value IS NOT NULL THEN
    NEW.final_tuition_value = NEW.full_tuition_value * (1 - COALESCE(NEW.discount, 0) / 100);
  END IF;
  RETURN NEW;
END;
$$;
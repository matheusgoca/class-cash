-- Fix function search paths for security
CREATE OR REPLACE FUNCTION public.calculate_tuition_final_amount()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Calculate final amount: base amount - discount + penalty
  NEW.final_amount = NEW.amount - COALESCE(NEW.discount_applied, 0) + COALESCE(NEW.penalty_amount, 0);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_contract_tuitions(contract_uuid UUID)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  contract_record RECORD;
  current_month DATE;
  tuition_amount NUMERIC;
BEGIN
  -- Get contract details
  SELECT * INTO contract_record FROM public.contracts WHERE id = contract_uuid;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found';
  END IF;
  
  -- Only generate for active contracts
  IF contract_record.status != 'active' THEN
    RETURN;
  END IF;
  
  -- Calculate tuition amount with discount
  tuition_amount = contract_record.monthly_amount - (contract_record.monthly_amount * contract_record.discount / 100);
  
  -- Generate tuitions for each month from start_date to end_date
  current_month := date_trunc('month', contract_record.start_date);
  
  WHILE current_month <= contract_record.end_date LOOP
    -- Check if tuition already exists for this month
    IF NOT EXISTS (
      SELECT 1 FROM public.tuitions 
      WHERE contract_id = contract_uuid 
      AND date_trunc('month', due_date) = current_month
    ) THEN
      -- Insert new tuition
      INSERT INTO public.tuitions (
        contract_id,
        student_id,
        amount,
        discount_applied,
        final_amount,
        due_date,
        description,
        status
      ) VALUES (
        contract_uuid,
        contract_record.student_id,
        contract_record.monthly_amount,
        contract_record.monthly_amount * contract_record.discount / 100,
        tuition_amount,
        (current_month + INTERVAL '1 month - 1 day'), -- Last day of the month
        'Mensalidade ' || to_char(current_month, 'MM/YYYY'),
        'pending'
      );
    END IF;
    
    current_month := current_month + INTERVAL '1 month';
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_contract_changes()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Generate tuitions for new or reactivated contracts
  IF (TG_OP = 'INSERT' AND NEW.status = 'active') OR 
     (TG_OP = 'UPDATE' AND OLD.status != 'active' AND NEW.status = 'active') THEN
    PERFORM public.generate_contract_tuitions(NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$;
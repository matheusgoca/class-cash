-- Create contracts table
CREATE TABLE public.contracts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL,
  class_id UUID NULL,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '1 year'),
  monthly_amount NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on contracts
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for contracts
CREATE POLICY "Admin and financial can manage contracts" 
ON public.contracts 
FOR ALL 
USING (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]));

CREATE POLICY "Teachers can view contracts" 
ON public.contracts 
FOR SELECT 
USING (get_current_user_role() = 'teacher'::text);

-- Add contract_id to tuitions table and update structure
ALTER TABLE public.tuitions 
ADD COLUMN contract_id UUID REFERENCES public.contracts(id),
ADD COLUMN discount_applied NUMERIC DEFAULT 0,
ADD COLUMN penalty_amount NUMERIC DEFAULT 0,
ADD COLUMN final_amount NUMERIC DEFAULT 0;

-- Update tuitions status check constraint
ALTER TABLE public.tuitions 
DROP CONSTRAINT IF EXISTS tuitions_status_check,
ADD CONSTRAINT tuitions_status_check CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled'));

-- Create trigger for automatic updated_at on contracts
CREATE TRIGGER update_contracts_updated_at
BEFORE UPDATE ON public.contracts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to calculate final tuition amount
CREATE OR REPLACE FUNCTION public.calculate_tuition_final_amount()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate final amount: base amount - discount + penalty
  NEW.final_amount = NEW.amount - COALESCE(NEW.discount_applied, 0) + COALESCE(NEW.penalty_amount, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic final_amount calculation
CREATE TRIGGER calculate_tuition_final_amount_trigger
BEFORE INSERT OR UPDATE ON public.tuitions
FOR EACH ROW
EXECUTE FUNCTION public.calculate_tuition_final_amount();

-- Create function to generate monthly tuitions for a contract
CREATE OR REPLACE FUNCTION public.generate_contract_tuitions(contract_uuid UUID)
RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to auto-generate tuitions when contract is created/updated
CREATE OR REPLACE FUNCTION public.handle_contract_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Generate tuitions for new or reactivated contracts
  IF (TG_OP = 'INSERT' AND NEW.status = 'active') OR 
     (TG_OP = 'UPDATE' AND OLD.status != 'active' AND NEW.status = 'active') THEN
    PERFORM public.generate_contract_tuitions(NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER handle_contract_changes_trigger
AFTER INSERT OR UPDATE ON public.contracts
FOR EACH ROW
EXECUTE FUNCTION public.handle_contract_changes();
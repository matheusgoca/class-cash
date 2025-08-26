-- Add new fields to students table
ALTER TABLE public.students 
ADD COLUMN email TEXT,
ADD COLUMN phone TEXT,
ADD COLUMN enrollment_date DATE DEFAULT CURRENT_DATE,
ADD COLUMN full_tuition_value NUMERIC(10,2),
ADD COLUMN discount NUMERIC(5,2) DEFAULT 0,
ADD COLUMN final_tuition_value NUMERIC(10,2);

-- Add new fields to classes table
ALTER TABLE public.classes
ADD COLUMN description TEXT,
ADD COLUMN tuition_per_student NUMERIC(10,2) DEFAULT 0;

-- Create function to automatically calculate final tuition value
CREATE OR REPLACE FUNCTION public.calculate_final_tuition()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate final tuition value based on full value and discount
  IF NEW.full_tuition_value IS NOT NULL THEN
    NEW.final_tuition_value = NEW.full_tuition_value * (1 - COALESCE(NEW.discount, 0) / 100);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically calculate final tuition on insert/update
CREATE TRIGGER calculate_student_final_tuition
  BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_final_tuition();
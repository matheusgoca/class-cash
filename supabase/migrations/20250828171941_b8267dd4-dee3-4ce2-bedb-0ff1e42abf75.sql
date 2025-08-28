-- Create teachers table with all required fields
CREATE TABLE IF NOT EXISTS public.teachers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  specialization TEXT,
  salary NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

-- Create policies for teachers table
CREATE POLICY "Admin and financial can manage teachers" 
ON public.teachers 
FOR ALL 
USING (get_current_user_role() = ANY (ARRAY['admin'::text, 'financial'::text]));

CREATE POLICY "Teachers can view teachers" 
ON public.teachers 
FOR SELECT 
USING (get_current_user_role() = 'teacher'::text);

-- Add foreign key relationship from classes to teachers
ALTER TABLE public.classes 
ADD CONSTRAINT fk_classes_teacher 
FOREIGN KEY (teacher_id) REFERENCES public.teachers(id) ON DELETE SET NULL;

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_teachers_updated_at
  BEFORE UPDATE ON public.teachers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for better performance
CREATE INDEX idx_teachers_email ON public.teachers(email);
CREATE INDEX idx_teachers_status ON public.teachers(status);
CREATE INDEX idx_classes_teacher_id ON public.classes(teacher_id);
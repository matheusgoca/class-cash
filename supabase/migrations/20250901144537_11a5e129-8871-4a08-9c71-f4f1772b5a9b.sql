-- Add phone field to teachers table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teachers' AND column_name = 'phone') THEN
        ALTER TABLE public.teachers ADD COLUMN phone text;
    END IF;
END $$;
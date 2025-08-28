-- Update teachers table to ensure it has all required fields
ALTER TABLE public.teachers 
ADD COLUMN IF NOT EXISTS full_name TEXT,
ADD COLUMN IF NOT EXISTS salary NUMERIC DEFAULT 0;

-- Update existing name column to full_name if needed
UPDATE public.teachers SET full_name = name WHERE full_name IS NULL AND name IS NOT NULL;

-- Make full_name required if it exists
ALTER TABLE public.teachers ALTER COLUMN full_name SET NOT NULL;

-- Make salary required with default 0
ALTER TABLE public.teachers ALTER COLUMN salary SET NOT NULL;
ALTER TABLE public.teachers ALTER COLUMN salary SET DEFAULT 0;

-- Rename name column to full_name if it exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'teachers' 
        AND column_name = 'name' 
        AND table_schema = 'public'
    ) THEN
        -- Copy data if full_name is empty
        UPDATE public.teachers SET full_name = name WHERE full_name IS NULL;
        -- Drop the old name column
        ALTER TABLE public.teachers DROP COLUMN IF EXISTS name;
    END IF;
END $$;

-- Rename subject to specialization if needed
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'teachers' 
        AND column_name = 'subject' 
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.teachers RENAME COLUMN subject TO specialization;
    END IF;
END $$;
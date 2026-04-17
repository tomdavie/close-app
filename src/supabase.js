import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wbdeqdmfkjoahivopqtd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndiZGVxZG1ma2pvYWhpdm9wcXRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxODI0MzAsImV4cCI6MjA5MTc1ODQzMH0._H8_ZYaWjgQ0-dPyrcculVnHTHSG0dm7VKlTgGK-Eew';

export const supabase = createClient(supabaseUrl, supabaseKey);
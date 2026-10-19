import { createClient } from '@supabase/supabase-js';
import { makeDeleteAccountHandler } from './_lib/accountDeletion.js';

export default makeDeleteAccountHandler({ createClient });

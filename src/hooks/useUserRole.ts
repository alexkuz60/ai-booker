import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export function useUserRole() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.id) { setLoaded(true); return; }
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .then(({ data }) => {
        setIsAdmin(data?.some(r => r.role === 'admin') ?? false);
        setLoaded(true);
      });
  }, [user?.id]);

  return { isAdmin, loaded };
}

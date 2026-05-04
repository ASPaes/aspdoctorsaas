import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MetaTemplate {
  id: string;
  tenant_id: string;
  instance_id: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: string;
  status: string;
  body_text: string | null;
  body_variables_count: number;
  header_type: string | null;
  header_content: string | null;
  footer_text: string | null;
  buttons: any | null;
  components: any;
  synced_at: string;
}

export function useMetaTemplates(instanceId: string | null | undefined) {
  return useQuery({
    queryKey: ['meta-templates', instanceId],
    enabled: !!instanceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whatsapp_meta_templates')
        .select('*')
        .eq('instance_id', instanceId!)
        .eq('status', 'APPROVED')
        .order('language', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data || []) as MetaTemplate[];
    },
    staleTime: 60_000,
  });
}

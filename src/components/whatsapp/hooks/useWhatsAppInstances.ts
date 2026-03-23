import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';

interface Instance {
  id: string;
  tenant_id: string;
  instance_name: string;
  display_name: string | null;
  phone_number: string | null;
  status: string;
  provider_type: string;
  instance_id_external: string | null;
  webhook_url: string | null;
  created_at: string;
  updated_at: string;
}

export const useWhatsAppInstances = () => {
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const { data: instances = [], isLoading, error } = useQuery({
    queryKey: ['whatsapp', 'instances', tid],
    queryFn: async () => {
      let q = supabase.from('whatsapp_instances').select('*').order('created_at', { ascending: false });
      if (tid) q = q.eq('tenant_id', tid);
      const { data, error } = await q;
      if (error) throw error;
      return data as Instance[];
    },
  });

  const createInstance = useMutation({
    mutationFn: async (instance: any) => {
      const { api_url, api_key, provider_type, instance_id_external,
              meta_phone_number_id, meta_access_token, meta_verify_token,
              ...instanceData } = instance;

      const isMeta = provider_type === 'meta_cloud';

      const { data: instanceResult, error: instanceError } = await (supabase
        .from('whatsapp_instances') as any)
        .insert({
          ...instanceData,
          provider_type: provider_type || 'self_hosted',
          instance_id_external: instance_id_external || null,
          ...(isMeta && meta_phone_number_id ? { meta_phone_number_id } : {}),
        })
        .select()
        .single();

      if (instanceError) throw instanceError;

      const secretsPayload: any = {
        instance_id: instanceResult.id,
        api_url: api_url || '',
        api_key: api_key || '',
      };
      if (isMeta) {
        secretsPayload.meta_access_token = meta_access_token || null;
        secretsPayload.meta_verify_token = meta_verify_token || null;
      }

      const { error: secretsError } = await (supabase
        .from('whatsapp_instance_secrets') as any)
        .insert(secretsPayload);

      if (secretsError) {
        await supabase.from('whatsapp_instances').delete().eq('id', instanceResult.id);
        throw secretsError;
      }

      return instanceResult;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['whatsapp', 'instances'] }); },
  });

  const updateInstance = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { api_url, api_key, provider_type, instance_id_external, ...instanceUpdates } = updates;

      const finalUpdates = {
        ...instanceUpdates,
        ...(provider_type && { provider_type }),
        ...(instance_id_external !== undefined && { instance_id_external }),
      };

      const { data, error: instanceError } = await (supabase
        .from('whatsapp_instances') as any)
        .update(finalUpdates)
        .eq('id', id)
        .select()
        .single();

      if (instanceError) throw instanceError;

      if (api_url || api_key) {
        const { error: secretsError } = await (supabase
          .from('whatsapp_instance_secrets') as any)
          .upsert(
            { instance_id: id, ...(api_url && { api_url }), ...(api_key && { api_key }) },
            { onConflict: 'instance_id' }
          );
        if (secretsError) throw secretsError;
      }

      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['whatsapp', 'instances'] }); },
  });

  const deleteInstance = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('whatsapp_instances').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['whatsapp', 'instances'] }); },
  });

  const testConnection = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('test-instance-connection', { body: { instanceId: id } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['whatsapp', 'instances'] }); },
  });

  return { instances, isLoading, error, createInstance, updateInstance, deleteInstance, testConnection };
};

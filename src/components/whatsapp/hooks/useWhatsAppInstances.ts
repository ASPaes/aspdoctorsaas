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
      // Edge Function: suporta criação em qualquer tenant (super_admin via target_tenant_id)
      const { data: result, error } = await supabase.functions.invoke('create-whatsapp-instance', {
        body: {
          ...instance,
          target_tenant_id: tid || undefined,
        },
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'instances'] });
    },
  });

  const updateInstance = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const {
        api_url, api_key,
        provider_type,
        instance_id_external,
        meta_phone_number_id, meta_access_token, meta_verify_token, meta_app_secret,
        zapi_instance_id, zapi_token, zapi_client_token,
        ...instanceUpdates
      } = updates;

      const finalUpdates = {
        ...instanceUpdates,
        ...(provider_type && { provider_type }),
        ...(instance_id_external !== undefined && { instance_id_external }),
        ...(meta_phone_number_id !== undefined && { meta_phone_number_id }),
      };

      const { data, error: instanceError } = await (supabase
        .from('whatsapp_instances') as any)
        .update(finalUpdates)
        .eq('id', id)
        .select()
        .single();

      if (instanceError) throw instanceError;

      const secretsUpdate: any = {};
      if (api_url) secretsUpdate.api_url = api_url;
      if (api_key) secretsUpdate.api_key = api_key;
      if (meta_access_token !== undefined) secretsUpdate.meta_access_token = meta_access_token;
      if (meta_verify_token !== undefined) secretsUpdate.meta_verify_token = meta_verify_token;
      if (meta_app_secret !== undefined) secretsUpdate.meta_app_secret = meta_app_secret;
      if (zapi_instance_id !== undefined) secretsUpdate.zapi_instance_id = zapi_instance_id;
      if (zapi_token !== undefined) secretsUpdate.zapi_token = zapi_token;
      if (zapi_client_token !== undefined) secretsUpdate.zapi_client_token = zapi_client_token;

      if (Object.keys(secretsUpdate).length > 0) {
        const { error: secretsError } = await supabase.functions.invoke('upsert-instance-secrets', {
          body: { instance_id: id, ...secretsUpdate },
        });
        if (secretsError) throw secretsError;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'instances'] });
    },
  });

  const deleteInstance = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('whatsapp_instances').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'instances'] });
    },
  });

  const testConnection = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('test-instance-connection', {
        body: { instanceId: id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'instances'] });
    },
  });

  return { instances, isLoading, error, createInstance, updateInstance, deleteInstance, testConnection };
};

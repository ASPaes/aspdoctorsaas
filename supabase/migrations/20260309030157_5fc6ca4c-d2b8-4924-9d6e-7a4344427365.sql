ALTER TABLE public.whatsapp_contacts 
ADD CONSTRAINT whatsapp_contacts_instance_phone_unique 
UNIQUE (instance_id, phone_number);
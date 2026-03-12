import { User, MessageCircle, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ContactInfo {
  displayName: string | null;
  vcard: string | null;
}

interface ContactCardProps {
  metadata: Record<string, any> | null;
  messageType: string;
  isFromMe: boolean;
  onStartConversation?: (phone: string, name: string) => void;
}

function parseVCard(vcard: string | null): { name: string; phones: string[] } {
  if (!vcard) return { name: '', phones: [] };

  let name = '';
  const phones: string[] = [];

  const lines = vcard.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('FN:')) {
      name = line.substring(3).trim();
    }
    // Match TEL lines: TEL;type=CELL:+55... or TEL:+55... or waid=...
    if (line.toUpperCase().startsWith('TEL')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const phone = line.substring(colonIdx + 1).trim();
        if (phone) phones.push(phone);
      }
    }
  }

  return { name, phones };
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) {
    const ddd = digits.substring(2, 4);
    const number = digits.substring(4);
    if (number.length === 9) {
      return `(${ddd}) ${number.substring(0, 5)}-${number.substring(5)}`;
    }
    if (number.length === 8) {
      return `(${ddd}) ${number.substring(0, 4)}-${number.substring(4)}`;
    }
  }
  return phone;
}

function SingleContactCard({
  contact,
  isFromMe,
  onStartConversation,
}: {
  contact: ContactInfo;
  isFromMe: boolean;
  onStartConversation?: (phone: string, name: string) => void;
}) {
  const { name, phones } = parseVCard(contact.vcard);
  const displayName = contact.displayName || name || 'Contato';
  const primaryPhone = phones[0] || '';

  const handleChat = () => {
    if (primaryPhone && onStartConversation) {
      const digits = primaryPhone.replace(/\D/g, '');
      onStartConversation(digits, displayName);
    }
  };

  const handleAddContact = () => {
    if (primaryPhone) {
      const digits = primaryPhone.replace(/\D/g, '');
      // Open WhatsApp web link to add contact (or navigate to contacts page)
      window.open(`https://wa.me/${digits}`, '_blank');
    }
  };

  return (
    <div className={cn(
      "rounded-md border p-3 mb-1 min-w-[220px] max-w-[300px]",
      isFromMe
        ? "bg-primary-foreground/10 border-primary-foreground/20"
        : "bg-background/50 border-border/50"
    )}>
      <div className="flex items-center gap-2.5 mb-2">
        <div className={cn(
          "h-10 w-10 rounded-full flex items-center justify-center shrink-0",
          isFromMe ? "bg-primary-foreground/20" : "bg-muted"
        )}>
          <User className={cn("h-5 w-5", isFromMe ? "text-primary-foreground/70" : "text-muted-foreground")} />
        </div>
        <div className="min-w-0">
          <p className={cn(
            "text-sm font-medium truncate",
            isFromMe ? "text-primary-foreground" : "text-foreground"
          )}>
            {displayName}
          </p>
          {primaryPhone && (
            <p className={cn(
              "text-[11px] opacity-70",
              isFromMe ? "text-primary-foreground" : "text-muted-foreground"
            )}>
              {formatPhone(primaryPhone)}
            </p>
          )}
        </div>
      </div>

      <div className={cn(
        "flex gap-2 pt-2 border-t",
        isFromMe ? "border-primary-foreground/20" : "border-border/50"
      )}>
        {primaryPhone && onStartConversation && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "flex-1 h-7 text-xs gap-1",
              isFromMe
                ? "text-primary-foreground hover:bg-primary-foreground/10"
                : "text-foreground hover:bg-accent"
            )}
            onClick={handleChat}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Conversar
          </Button>
        )}
        {primaryPhone && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "flex-1 h-7 text-xs gap-1",
              isFromMe
                ? "text-primary-foreground hover:bg-primary-foreground/10"
                : "text-foreground hover:bg-accent"
            )}
            onClick={handleAddContact}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Adicionar
          </Button>
        )}
      </div>
    </div>
  );
}

export function ContactCard({ metadata, messageType, isFromMe, onStartConversation }: ContactCardProps) {
  if (!metadata) return null;

  if (messageType === 'contact' && metadata.contact) {
    return (
      <SingleContactCard
        contact={metadata.contact}
        isFromMe={isFromMe}
        onStartConversation={onStartConversation}
      />
    );
  }

  if (messageType === 'contacts' && metadata.contacts) {
    return (
      <div className="flex flex-col gap-1.5">
        {(metadata.contacts as ContactInfo[]).map((c, i) => (
          <SingleContactCard
            key={i}
            contact={c}
            isFromMe={isFromMe}
            onStartConversation={onStartConversation}
          />
        ))}
      </div>
    );
  }

  return null;
}

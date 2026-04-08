import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSchool } from "@/contexts/SchoolContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Users, RefreshCw, Mail } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Member {
  user_id: string;
  full_name: string;
  email: string;
  role: string | null;
  created_at: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  created_at: string;
}

const roleBadge = (role: string | null) => {
  switch (role) {
    case "admin":     return <Badge className="bg-blue-600 text-white">Admin</Badge>;
    case "financial": return <Badge className="bg-emerald-600 text-white">Financeiro</Badge>;
    case "teacher":   return <Badge className="bg-orange-500 text-white">Professor</Badge>;
    default:          return <Badge variant="outline">Owner</Badge>;
  }
};

export default function Team() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { schoolId } = useSchool();

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingInvites, setLoadingInvites] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "financial">("financial");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState<string | null>(null);

  useEffect(() => {
    if (schoolId) {
      fetchMembers();
      fetchInvitations();
    }
  }, [schoolId]);

  const fetchMembers = async () => {
    setLoadingMembers(true);
    // Busca profiles da escola
    const { data: profiles, error } = await (supabase as any)
      .from("profiles")
      .select("user_id, full_name, email, created_at")
      .eq("school_id", schoolId);

    if (error) {
      console.error("fetchMembers error:", error);
      setLoadingMembers(false);
      return;
    }

    // Busca roles de todos esses users de uma vez
    const userIds = (profiles || []).map((p: any) => p.user_id);
    const { data: roles } = userIds.length
      ? await supabase.from("user_roles").select("user_id, role").in("user_id", userIds)
      : { data: [] };

    const roleMap: Record<string, string> = {};
    (roles || []).forEach((r: any) => { roleMap[r.user_id] = r.role; });

    // Owner não aparece na lista (tem school_id mas não tem user_roles)
    const members: Member[] = (profiles || [])
      .filter((p: any) => p.user_id !== user?.id) // exclui o próprio owner/admin logado
      .map((p: any) => ({
        user_id: p.user_id,
        full_name: p.full_name || "—",
        email: p.email,
        role: roleMap[p.user_id] ?? null,
        created_at: p.created_at,
      }));

    setMembers(members);
    setLoadingMembers(false);
  };

  const fetchInvitations = async () => {
    setLoadingInvites(true);
    const { data, error } = await (supabase as any)
      .from("invitations")
      .select("id, email, role, created_at")
      .eq("school_id", schoolId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (!error) setInvitations(data || []);
    setLoadingInvites(false);
  };

  const handleInvite = async () => {
    if (!inviteEmail || !schoolId) return;
    setSubmitting(true);

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, school_id: schoolId }),
      }
    );

    const json = await res.json();
    if (!res.ok) {
      toast({ title: "Erro", description: json.error, variant: "destructive" });
    } else {
      toast({ title: "Convite enviado!", description: `Email enviado para ${inviteEmail}.` });
      setShowModal(false);
      setInviteEmail("");
      setInviteRole("financial");
      fetchInvitations();
    }
    setSubmitting(false);
  };

  const handleResend = async (invite: Invitation) => {
    setResending(invite.id);

    // Deleta o convite antigo
    await (supabase as any)
      .from("invitations")
      .delete()
      .eq("id", invite.id);

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ email: invite.email, role: invite.role, school_id: schoolId }),
      }
    );

    const json = await res.json();
    if (!res.ok) {
      toast({ title: "Erro ao reenviar", description: json.error, variant: "destructive" });
    } else {
      toast({ title: "Convite reenviado!", description: `Novo link enviado para ${invite.email}.` });
      fetchInvitations();
    }
    setResending(null);
  };

  const fmt = (d: string) => format(new Date(d), "dd/MM/yyyy", { locale: ptBR });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Equipe</h1>
          <p className="text-muted-foreground">Gerencie os membros da sua escola</p>
        </div>
        <Button onClick={() => setShowModal(true)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Convidar membro
        </Button>
      </div>

      {/* Membros ativos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Membros ativos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingMembers ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              Nenhum membro além de você. Convide alguém!
            </p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Função</TableHead>
                    <TableHead>Desde</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.user_id}>
                      <TableCell className="font-medium">{m.full_name}</TableCell>
                      <TableCell>{m.email}</TableCell>
                      <TableCell>{roleBadge(m.role)}</TableCell>
                      <TableCell>{fmt(m.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Convites pendentes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Convites pendentes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingInvites ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : invitations.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">Nenhum convite pendente.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Função</TableHead>
                    <TableHead>Enviado em</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.email}</TableCell>
                      <TableCell>{roleBadge(inv.role)}</TableCell>
                      <TableCell>{fmt(inv.created_at)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resending === inv.id}
                          onClick={() => handleResend(inv)}
                          className="gap-1"
                        >
                          <RefreshCw className={`h-3 w-3 ${resending === inv.id ? "animate-spin" : ""}`} />
                          Reenviar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal de convite */}
      {showModal && (
        <Dialog open onOpenChange={() => setShowModal(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Convidar membro</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colaborador@email.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1">
                <Label>Função</Label>
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v as "admin" | "financial")}
                  disabled={submitting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="financial">Financeiro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowModal(false)} disabled={submitting}>
                  Cancelar
                </Button>
                <Button onClick={handleInvite} disabled={submitting || !inviteEmail}>
                  {submitting ? "Enviando..." : "Enviar convite"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

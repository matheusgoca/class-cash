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
import { UserPlus, Users, RefreshCw, Mail, Pencil, Trash2, UserSearch } from "lucide-react";
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

type ModalType = "invite" | "add-existing" | "edit-role" | "remove" | null;

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  financial: "Financeiro",
  teacher: "Professor",
};

const roleBadge = (role: string | null) => {
  switch (role) {
    case "admin":     return <Badge className="bg-blue-600 text-white">Admin</Badge>;
    case "financial": return <Badge className="bg-emerald-600 text-white">Financeiro</Badge>;
    case "teacher":   return <Badge className="bg-orange-500 text-white">Professor</Badge>;
    default:          return <Badge variant="outline">Owner</Badge>;
  }
};

async function callInviteFunction(payload: object, accessToken: string) {
  return fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(payload),
    }
  );
}

export default function Team() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { schoolId, school } = useSchool();

  const [members, setMembers]         = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [submitting, setSubmitting]   = useState(false);
  const [resending, setResending]     = useState<string | null>(null);

  // Modal state
  const [modal, setModal]             = useState<ModalType>(null);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole]   = useState<"admin" | "financial">("financial");

  // Add existing form
  const [existingEmail, setExistingEmail] = useState("");
  const [existingRole, setExistingRole]   = useState<"admin" | "financial">("financial");

  // Edit role
  const [newRole, setNewRole] = useState<"admin" | "financial">("financial");

  useEffect(() => {
    if (schoolId) {
      fetchMembers();
      fetchInvitations();
    }
  }, [schoolId]);

  const fetchMembers = async () => {
    setLoadingMembers(true);
    const { data: profiles, error } = await (supabase as any)
      .from("profiles")
      .select("user_id, full_name, email, created_at")
      .eq("school_id", schoolId);

    if (error) { console.error("fetchMembers:", error); setLoadingMembers(false); return; }

    const userIds = (profiles || []).map((p: any) => p.user_id);
    const { data: roles } = userIds.length
      ? await supabase.from("user_roles").select("user_id, role").in("user_id", userIds)
      : { data: [] };

    const roleMap: Record<string, string> = {};
    (roles || []).forEach((r: any) => { roleMap[r.user_id] = r.role; });

    setMembers(
      (profiles || [])
        .filter((p: any) => p.user_id !== user?.id)
        .map((p: any) => ({
          user_id: p.user_id,
          full_name: p.full_name || "—",
          email: p.email,
          role: roleMap[p.user_id] ?? null,
          created_at: p.created_at,
        }))
    );
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

  const closeModal = () => {
    setModal(null);
    setSelectedMember(null);
    setInviteEmail("");
    setInviteRole("financial");
    setExistingEmail("");
    setExistingRole("financial");
  };

  // ── Convidar novo usuário ─────────────────────────────────────
  const handleInvite = async () => {
    if (!inviteEmail || !schoolId) return;
    setSubmitting(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await callInviteFunction(
      { email: inviteEmail, role: inviteRole, school_id: schoolId },
      session?.access_token ?? ""
    );
    const json = await res.json();
    if (!res.ok) {
      toast({ title: "Erro", description: json.error, variant: "destructive" });
    } else {
      toast({ title: "Convite enviado!", description: `Email enviado para ${inviteEmail}.` });
      closeModal();
      fetchInvitations();
    }
    setSubmitting(false);
  };

  // ── Reenviar convite ──────────────────────────────────────────
  const handleResend = async (invite: Invitation) => {
    setResending(invite.id);
    // Deleta convite antigo antes de tentar reenviar
    await (supabase as any).from("invitations").delete().eq("id", invite.id);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await callInviteFunction(
      { email: invite.email, role: invite.role, school_id: schoolId },
      session?.access_token ?? ""
    );
    const json = await res.json();

    if (!res.ok) {
      if (json.error === "user_exists") {
        // Convite já expirado pela Edge Function — abre modal de adicionar existente com email preenchido
        toast({ title: "Usuário já possui conta", description: json.message });
        fetchInvitations(); // atualiza lista (convite sumiu)
        setExistingEmail(invite.email);
        setExistingRole(invite.role as "admin" | "financial");
        setModal("add-existing");
      } else {
        toast({ title: "Erro ao reenviar", description: json.error, variant: "destructive" });
      }
    } else {
      toast({ title: "Convite reenviado!", description: `Novo link enviado para ${invite.email}.` });
      fetchInvitations();
    }
    setResending(null);
  };

  // ── Adicionar usuário existente ───────────────────────────────
  const handleAddExisting = async () => {
    if (!existingEmail || !schoolId) return;
    setSubmitting(true);

    // Verifica se já é membro
    const alreadyMember = members.some(m => m.email.toLowerCase() === existingEmail.toLowerCase());
    if (alreadyMember) {
      toast({ title: "Erro", description: "Este usuário já é membro da escola.", variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // Busca o usuário pelo email via RPC SECURITY DEFINER
    const { data: found, error: rpcError } = await (supabase as any)
      .rpc("get_user_by_email", { p_email: existingEmail.toLowerCase() });

    if (rpcError || !found || found.length === 0) {
      toast({
        title: "Usuário não encontrado",
        description: "Nenhuma conta com este email. Use 'Convidar membro' para enviar um convite.",
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    const targetUserId = found[0].id;

    // Vincula escola ao profile
    const { error: profileError } = await (supabase as any)
      .from("profiles")
      .update({ school_id: schoolId })
      .eq("user_id", targetUserId);

    if (profileError) {
      toast({ title: "Erro", description: profileError.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // Atribui role (upsert para evitar duplicata)
    const { error: roleError } = await supabase
      .from("user_roles")
      .upsert({ user_id: targetUserId, role: existingRole as any }, { onConflict: "user_id,role" });

    if (roleError) {
      toast({ title: "Erro", description: roleError.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    toast({ title: "Membro adicionado!", description: `${existingEmail} agora tem acesso à escola.` });
    closeModal();
    fetchMembers();
    setSubmitting(false);
  };

  // ── Editar role ───────────────────────────────────────────────
  const openEditRole = (m: Member) => {
    setSelectedMember(m);
    setNewRole((m.role as "admin" | "financial") ?? "financial");
    setModal("edit-role");
  };

  const handleEditRole = async () => {
    if (!selectedMember) return;
    setSubmitting(true);

    // Remove todas as roles atuais e insere a nova
    await supabase.from("user_roles").delete().eq("user_id", selectedMember.user_id);
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: selectedMember.user_id, role: newRole as any });

    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Função atualizada!", description: `${selectedMember.full_name} agora é ${ROLE_LABELS[newRole]}.` });
      closeModal();
      fetchMembers();
    }
    setSubmitting(false);
  };

  // ── Remover membro ────────────────────────────────────────────
  const openRemove = (m: Member) => {
    setSelectedMember(m);
    setModal("remove");
  };

  const handleRemove = async () => {
    if (!selectedMember) return;
    setSubmitting(true);

    await supabase.from("user_roles").delete().eq("user_id", selectedMember.user_id);
    await (supabase as any)
      .from("profiles")
      .update({ school_id: null })
      .eq("user_id", selectedMember.user_id);

    toast({ title: "Acesso removido", description: `${selectedMember.full_name} foi removido da escola.` });
    closeModal();
    fetchMembers();
    setSubmitting(false);
  };

  const fmt = (d: string) => format(new Date(d), "dd/MM/yyyy", { locale: ptBR });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Equipe</h1>
          <p className="text-muted-foreground">Gerencie os membros da sua escola</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setModal("add-existing")} className="gap-2">
            <UserSearch className="h-4 w-4" />
            Adicionar existente
          </Button>
          <Button onClick={() => setModal("invite")} className="gap-2">
            <UserPlus className="h-4 w-4" />
            Convidar membro
          </Button>
        </div>
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
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.user_id}>
                      <TableCell className="font-medium">{m.full_name}</TableCell>
                      <TableCell>{m.email}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {roleBadge(m.role)}
                          {m.role !== null && (
                            <button
                              onClick={() => openEditRole(m)}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              title="Editar função"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{fmt(m.created_at)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openRemove(m)}
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          title="Remover acesso"
                        >
                          <Trash2 className="h-4 w-4" />
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

      {/* ── Modal: Convidar novo membro ── */}
      {modal === "invite" && (
        <Dialog open onOpenChange={closeModal}>
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
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as any)} disabled={submitting}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="financial">Financeiro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeModal} disabled={submitting}>Cancelar</Button>
                <Button onClick={handleInvite} disabled={submitting || !inviteEmail}>
                  {submitting ? "Enviando..." : "Enviar convite"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Modal: Adicionar usuário existente ── */}
      {modal === "add-existing" && (
        <Dialog open onOpenChange={closeModal}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Adicionar membro existente</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Para usuários que já têm conta no Class Cash.
            </p>
            <div className="space-y-4 pt-1">
              <div className="space-y-1">
                <Label htmlFor="existing-email">Email da conta</Label>
                <Input
                  id="existing-email"
                  type="email"
                  placeholder="colaborador@email.com"
                  value={existingEmail}
                  onChange={(e) => setExistingEmail(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1">
                <Label>Função</Label>
                <Select value={existingRole} onValueChange={(v) => setExistingRole(v as any)} disabled={submitting}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="financial">Financeiro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeModal} disabled={submitting}>Cancelar</Button>
                <Button onClick={handleAddExisting} disabled={submitting || !existingEmail}>
                  {submitting ? "Adicionando..." : "Adicionar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Modal: Editar role ── */}
      {modal === "edit-role" && selectedMember && (
        <Dialog open onOpenChange={closeModal}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Editar função — {selectedMember.full_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1">
                <Label>Nova função</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as any)} disabled={submitting}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="financial">Financeiro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeModal} disabled={submitting}>Cancelar</Button>
                <Button onClick={handleEditRole} disabled={submitting}>
                  {submitting ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Modal: Confirmar remoção ── */}
      {modal === "remove" && selectedMember && (
        <Dialog open onOpenChange={closeModal}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Remover acesso</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Tem certeza que deseja remover o acesso de{" "}
              <span className="font-semibold text-foreground">{selectedMember.full_name}</span>?
              A conta do usuário continuará existindo, mas ele perderá acesso à escola.
            </p>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={closeModal} disabled={submitting}>Cancelar</Button>
              <Button variant="destructive" onClick={handleRemove} disabled={submitting}>
                {submitting ? "Removendo..." : "Remover acesso"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

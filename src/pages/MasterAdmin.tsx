import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Edit, ShieldCheck, GraduationCap, DollarSign, AlertTriangle, CalendarDays, Mail, Plus, Lightbulb, BookOpen, Building2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { useMasterAdmin } from "@/contexts/MasterAdminContext";
import { useSchool } from "@/contexts/SchoolContext";

interface SchoolRow {
  id: string;
  name: string;
  plan: string;
  status: string;
  created_at: string;
  owner_user_id: string;
  owner_email: string;
  student_count: number;
  monthly_revenue: number;
  overdue_pct: number;
}

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
};

const PLAN_COLORS: Record<string, string> = {
  starter: "bg-slate-100 text-slate-700 border-slate-200",
  pro: "bg-blue-100 text-blue-700 border-blue-200",
  enterprise: "bg-purple-100 text-purple-700 border-purple-200",
};

export default function MasterAdmin() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { enterSchool } = useMasterAdmin();
  const { school } = useSchool();

  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSchool, setEditingSchool] = useState<SchoolRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", plan: "starter", status: "active" });
  const [saving, setSaving] = useState(false);
  const [waitingForSchool, setWaitingForSchool] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', ownerEmail: '', plan: 'starter', segments: [] as string[] });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchSchools();
  }, []);

  useEffect(() => {
    if (waitingForSchool && school) {
      setWaitingForSchool(false);
      navigate("/dashboard");
    }
  }, [waitingForSchool, school]);

  const fetchSchools = async () => {
    setLoading(true);
    try {
      const [schoolsRes, profilesRes, studentsRes, tuitionsRes] = await Promise.all([
        (supabase as any).from("schools").select("id, name, plan, status, created_at, owner_user_id").order("created_at", { ascending: false }),
        (supabase as any).from("profiles").select("user_id, email"),
        (supabase as any).from("students").select("school_id").eq("status", "active"),
        (supabase as any).from("tuitions").select("school_id, amount, status").neq("status", "cancelled"),
      ]);

      const profileMap: Record<string, string> = (profilesRes.data || []).reduce((acc: any, p: any) => {
        acc[p.user_id] = p.email;
        return acc;
      }, {});

      const studentCount: Record<string, number> = (studentsRes.data || []).reduce((acc: any, s: any) => {
        acc[s.school_id] = (acc[s.school_id] || 0) + 1;
        return acc;
      }, {});

      const revenueBySchool: Record<string, number> = {};
      const totalBySchool: Record<string, number> = {};
      const overdueBySchool: Record<string, number> = {};

      for (const t of tuitionsRes.data || []) {
        const sid = t.school_id;
        const amt = Number(t.amount || 0);
        totalBySchool[sid] = (totalBySchool[sid] || 0) + amt;
        if (t.status === "paid") revenueBySchool[sid] = (revenueBySchool[sid] || 0) + amt;
        if (t.status === "overdue") overdueBySchool[sid] = (overdueBySchool[sid] || 0) + amt;
      }

      const rows: SchoolRow[] = (schoolsRes.data || []).map((s: any) => {
        const total = totalBySchool[s.id] || 0;
        const overdue = overdueBySchool[s.id] || 0;
        return {
          id: s.id,
          name: s.name,
          plan: s.plan || "starter",
          status: s.status || "active",
          created_at: s.created_at,
          owner_user_id: s.owner_user_id,
          owner_email: profileMap[s.owner_user_id] || "—",
          student_count: studentCount[s.id] || 0,
          monthly_revenue: revenueBySchool[s.id] || 0,
          overdue_pct: total > 0 ? (overdue / total) * 100 : 0,
        };
      });

      setSchools(rows);
    } catch (err) {
      console.error("MasterAdmin fetchSchools:", err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  const openEdit = (school: SchoolRow) => {
    setEditingSchool(school);
    setEditForm({ name: school.name, plan: school.plan, status: school.status });
  };

  const handleSave = async () => {
    if (!editingSchool) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from("schools")
        .update({ name: editForm.name, plan: editForm.plan, status: editForm.status })
        .eq("id", editingSchool.id);
      if (error) throw error;
      toast({ title: "Escola atualizada com sucesso!" });
      setEditingSchool(null);
      fetchSchools();
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const SEGMENTS = [
    { value: 'infantil', label: 'Ed. Infantil', icon: Lightbulb },
    { value: 'fundamental', label: 'Fundamental', icon: BookOpen },
    { value: 'medio', label: 'Ensino Médio', icon: GraduationCap },
    { value: 'tecnico', label: 'Técnico', icon: Building2 },
  ];

  const toggleSegment = (value: string) => {
    setCreateForm((f) => ({
      ...f,
      segments: f.segments.includes(value)
        ? f.segments.filter((s) => s !== value)
        : [...f.segments, value],
    }));
  };

  const handleCreateSchool = async () => {
    if (!createForm.name.trim() || !createForm.ownerEmail.trim() || createForm.segments.length === 0) {
      toast({ title: 'Preencha nome, e-mail do dono e pelo menos um segmento', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-school-owner', {
        body: {
          email:       createForm.ownerEmail.trim().toLowerCase(),
          school_name: createForm.name.trim(),
          segments:    createForm.segments,
          plan:        createForm.plan,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Convite enviado!',
        description: `${createForm.ownerEmail} receberá um e-mail para criar o acesso à escola "${createForm.name}".`,
      });
      setShowCreate(false);
      setCreateForm({ name: '', ownerEmail: '', plan: 'starter', segments: [] });
    } catch (err: any) {
      toast({ title: 'Erro ao convidar', description: err.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleEnterSchool = (schoolRow: SchoolRow) => {
    setWaitingForSchool(true);
    enterSchool(schoolRow.id, schoolRow.name);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Class Cash — Painel Master</h1>
            <p className="text-sm text-muted-foreground">Visão geral de todas as escolas cadastradas</p>
          </div>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Escola
        </Button>
      </div>

      {/* Counter */}
      <p className="text-sm font-medium text-muted-foreground">
        Escolas ({schools.length})
      </p>

      {/* School cards grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : schools.length === 0 ? (
        <p className="text-center py-16 text-muted-foreground">Nenhuma escola cadastrada.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {schools.map((school) => (
            <Card key={school.id} className="overflow-hidden">
              <CardContent className="p-5 space-y-4">

                {/* Row 1: name + badges */}
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-bold leading-tight">{school.name}</h2>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${PLAN_COLORS[school.plan] || PLAN_COLORS.starter}`}>
                      {PLAN_LABELS[school.plan] || school.plan}
                    </span>
                    {school.status === "active"
                      ? <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">Ativa</Badge>
                      : <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Suspensa</Badge>}
                  </div>
                </div>

                {/* Row 2: owner email + date */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {school.owner_email}
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {school.created_at
                      ? format(new Date(school.created_at), "dd/MM/yyyy", { locale: ptBR })
                      : "—"}
                  </span>
                </div>

                <div className="border-t" />

                {/* Row 3: metrics */}
                <div className="flex items-center gap-5 text-sm">
                  <span className="flex items-center gap-1.5">
                    <GraduationCap className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{school.student_count}</span>
                    <span className="text-muted-foreground">alunos</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{formatCurrency(school.monthly_revenue)}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className={`h-4 w-4 ${school.overdue_pct > 20 ? "text-red-500" : "text-muted-foreground"}`} />
                    <span className={`font-semibold ${school.overdue_pct > 20 ? "text-red-600" : ""}`}>
                      {school.overdue_pct.toFixed(1)}%
                    </span>
                    <span className="text-muted-foreground">inadimp.</span>
                  </span>
                </div>

                {/* Row 4: actions */}
                <div className="flex items-center gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => handleEnterSchool(school)}
                  >
                    Acessar escola
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => openEdit(school)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>

              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create school modal */}
      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setShowCreate(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Escola</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>E-mail do cliente</Label>
              <Input
                type="email"
                placeholder="cliente@exemplo.com"
                value={createForm.ownerEmail}
                onChange={(e) => setCreateForm((f) => ({ ...f, ownerEmail: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">Um e-mail de convite será enviado com o link de primeiro acesso.</p>
            </div>
            <div>
              <Label>Nome da escola</Label>
              <Input
                placeholder="Ex: Colégio São Paulo"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Plano</Label>
              <Select value={createForm.plan} onValueChange={(v) => setCreateForm((f) => ({ ...f, plan: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-2 block">Segmentos</Label>
              <div className="grid grid-cols-2 gap-2">
                {SEGMENTS.map((seg) => {
                  const Icon = seg.icon;
                  const active = createForm.segments.includes(seg.value);
                  return (
                    <button
                      key={seg.value}
                      type="button"
                      onClick={() => toggleSegment(seg.value)}
                      className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all ${
                        active ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      {seg.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreateSchool} disabled={creating}>
              {creating ? 'Enviando...' : 'Enviar convite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit modal */}
      <Dialog open={!!editingSchool} onOpenChange={(open) => { if (!open) setEditingSchool(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar escola</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome da escola</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>Plano</Label>
              <Select value={editForm.plan} onValueChange={(v) => setEditForm(f => ({ ...f, plan: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={(v) => setEditForm(f => ({ ...f, status: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativa</SelectItem>
                  <SelectItem value="suspended">Suspensa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSchool(null)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

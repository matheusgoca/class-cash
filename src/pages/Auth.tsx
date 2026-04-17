import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign } from 'lucide-react';

type View = 'auth' | 'set-password';

const Auth = () => {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState<string | null>(null);
  const [view, setView]         = useState<View>('auth');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  // Tokens do convite — guardados para usar no submit (setSession adiado)
  const [inviteTokens, setInviteTokens] = useState<{ access: string; refresh: string } | null>(null);
  // Ref síncrona: true durante todo o fluxo de convite, impede redirect do AuthContext
  const isInviteFlow = useRef(false);
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();

  // Detecta type=invite no hash — guarda tokens e mostra formulário SEM criar sessão ainda
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const type         = hash.get('type');
    const accessToken  = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');

    if (type !== 'invite' || !accessToken || !refreshToken) return;

    console.log('1. type=invite detectado — tokens guardados, aguardando senha');
    isInviteFlow.current = true;
    setInviteTokens({ access: accessToken, refresh: refreshToken });
    setView('set-password');
    // Limpa o hash para não vazar tokens na URL
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // Redireciona usuário já logado — ignora durante fluxo de convite
  useEffect(() => {
    if (user && view === 'auth' && !isInviteFlow.current) navigate('/');
  }, [user, navigate, view]);

  // Submete nova senha: seta sessão, define senha, vincula escola, redireciona
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('=== handleSetPassword INICIADO ===');
    console.log('password length:', password.length, 'confirm length:', confirm.length, 'inviteTokens:', inviteTokens);

    if (password !== confirm) { setError('As senhas não coincidem.'); return; }
    if (password.length < 6)  { setError('A senha deve ter ao menos 6 caracteres.'); return; }
    if (!inviteTokens) {
      console.error('inviteTokens é null — tokens perdidos');
      setError('Tokens de convite ausentes. Tente o link novamente.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Seta a sessão com os tokens do convite (só agora, após o usuário ter digitado a senha)
      console.log('2. setSession...');
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: inviteTokens.access,
        refresh_token: inviteTokens.refresh,
      });
      if (sessionError) {
        console.error('setSession ERRO:', sessionError);
        setError('Link de convite inválido ou expirado. Peça um novo convite.');
        setLoading(false);
        return;
      }
      console.log('3. sessão setada');

      // 2. Define a senha
      const { data: updateData, error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        console.error('updateUser ERRO:', updateError);
        setError(updateError.message);
        setLoading(false);
        return;
      }
      console.log('4. senha definida');

      const uid   = updateData.user!.id;
      const email = updateData.user!.email!;
      console.log('uid:', uid, 'email:', email);

      // 3. Busca convite pendente
      const { data: invite, error: inviteError } = await (supabase as any)
        .from('invitations')
        .select('id, school_id, role')
        .eq('email', email)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      console.log('5. convite encontrado:', invite, 'erro:', inviteError);

      if (!invite) {
        console.warn('Nenhum convite pendente para', email, '— redirecionando assim mesmo');
        window.location.href = '/dashboard';
        return;
      }

      // 4. Vincula school_id no profile
      const { error: profileError } = await (supabase as any)
        .from('profiles')
        .update({ school_id: invite.school_id })
        .eq('user_id', uid);
      if (profileError) console.error('profiles ERRO:', profileError);
      else console.log('6. profiles atualizado com school_id:', invite.school_id);

      // 5. Insere role
      const { error: roleError } = await supabase
        .from('user_roles')
        .upsert({ user_id: uid, role: invite.role });
      if (roleError) console.error('user_roles ERRO:', roleError);
      else console.log('7. user_roles inserido:', invite.role);

      // 6. Marca convite como aceito
      const { error: acceptError } = await (supabase as any)
        .from('invitations')
        .update({ status: 'accepted' })
        .eq('id', invite.id);
      if (acceptError) console.error('invitations ERRO:', acceptError);

      console.log('8. redirecionando para dashboard');
      window.location.href = '/dashboard';

    } catch (err) {
      console.error('=== ERRO em handleSetPassword:', err);
      setError('Ocorreu um erro inesperado. Tente novamente.');
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const { error } = await signIn(
      formData.get('email') as string,
      formData.get('password') as string,
    );
    if (error) setError(error.message);
    else navigate('/');
    setLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    const formData = new FormData(e.currentTarget);
    const { error } = await signUp(
      formData.get('email') as string,
      formData.get('password') as string,
      formData.get('fullName') as string,
    );
    if (error) setError(error.message);
    else setSuccess('Conta criada com sucesso! Verifique seu email para confirmar.');
    setLoading(false);
  };

  // ── Layout compartilhado ──────────────────────────────────────
  const leftPanel = (
    <div className="hidden lg:flex lg:w-1/2 bg-primary flex-col items-center justify-center p-12 text-primary-foreground">
      <div className="max-w-sm text-center space-y-6">
        <div className="flex items-center justify-center w-20 h-20 bg-white/10 rounded-2xl mx-auto">
          <DollarSign className="h-10 w-10" />
        </div>
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Class Cash</h1>
          <p className="text-primary-foreground/70 mt-2 text-lg">
            Gestão financeira escolar simplificada
          </p>
        </div>
        <div className="space-y-3 text-left text-sm text-primary-foreground/80">
          {[
            'Controle de contratos e mensalidades',
            'Geração automática de cobranças',
            'Relatórios de inadimplência e rentabilidade',
            'Visão por turma, professor e aluno',
          ].map((t) => (
            <div key={t} className="flex items-start gap-2">
              <span className="mt-0.5 text-primary-foreground">✓</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const mobileLogo = (
    <div className="flex lg:hidden items-center gap-3 justify-center">
      <div className="flex items-center justify-center w-10 h-10 bg-primary rounded-xl">
        <DollarSign className="h-5 w-5 text-primary-foreground" />
      </div>
      <span className="text-2xl font-bold">Class Cash</span>
    </div>
  );

  // ── Tela: definir senha (convite) ─────────────────────────────
  if (view === 'set-password') {
    return (
      <div className="min-h-screen flex">
        {leftPanel}
        <div className="flex-1 flex items-center justify-center p-6 bg-background">
          <div className="w-full max-w-md space-y-8">
            {mobileLogo}
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Bem-vindo ao Class Cash!</h2>
              <p className="text-muted-foreground mt-1">Crie uma senha para acessar sua conta.</p>
            </div>
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nova senha</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar senha</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="Repita a senha"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Salvando...' : 'Definir senha e entrar'}
              </Button>
            </form>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Tela: login / cadastro ────────────────────────────────────
  return (
    <div className="min-h-screen flex">
      {leftPanel}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md space-y-8">
          {mobileLogo}
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Acesso ao sistema</h2>
            <p className="text-muted-foreground mt-1">Entre com sua conta ou crie uma nova</p>
          </div>
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Cadastrar</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input id="signin-email" name="email" type="email" placeholder="seu@email.com" required disabled={loading} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Senha</Label>
                  <Input id="signin-password" name="password" type="password" placeholder="Sua senha" required disabled={loading} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Entrando...' : 'Entrar'}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Nome Completo</Label>
                  <Input id="signup-name" name="fullName" type="text" placeholder="Seu nome completo" required disabled={loading} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input id="signup-email" name="email" type="email" placeholder="seu@email.com" required disabled={loading} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Senha</Label>
                  <Input id="signup-password" name="password" type="password" placeholder="Crie uma senha (mín. 6 caracteres)" required disabled={loading} minLength={6} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Criando conta...' : 'Criar conta'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {success && (
            <Alert>
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { getFriendlyErrorMessage } from '@/lib/friendlyError';
import { DollarSign, Eye, EyeOff } from 'lucide-react';

type View = 'auth' | 'set-password' | 'forgot';

const Auth = () => {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState<string | null>(null);
  const [view, setView]         = useState<View>('auth');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  // Tokens do convite/recuperação — guardados para usar no submit (setSession adiado)
  const [inviteTokens, setInviteTokens] = useState<{ access: string; refresh: string } | null>(null);
  // Ref síncrona: 'invite' ou 'recovery' durante o fluxo de definir senha, impede
  // redirect do AuthContext e diz ao submit se deve chamar accept-invite ou não
  const flowKind = useRef<'invite' | 'recovery' | null>(null);
  // Toggle de visibilidade de senha
  const [showSignInPwd, setShowSignInPwd]   = useState(false);
  const [showSignUpPwd, setShowSignUpPwd]   = useState(false);
  const [showNewPwd, setShowNewPwd]         = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);

  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();

  // Abre direto na aba de cadastro quando vem de um CTA "criar conta" (?mode=signup)
  const initialTab = new URLSearchParams(window.location.search).get('mode') === 'signup' ? 'signup' : 'signin';

  // Detecta type=invite ou type=recovery no hash — guarda tokens e mostra
  // formulário de nova senha SEM criar sessão ainda
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const type         = hash.get('type');
    const accessToken  = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');

    if ((type !== 'invite' && type !== 'recovery') || !accessToken || !refreshToken) return;

    flowKind.current = type;
    setInviteTokens({ access: accessToken, refresh: refreshToken });
    setView('set-password');
    // Limpa o hash para não vazar tokens na URL
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // Redireciona usuário já logado — ignora durante fluxo de convite/recuperação
  useEffect(() => {
    if (user && view === 'auth' && !flowKind.current) navigate('/');
  }, [user, navigate, view]);

  // Submete nova senha: seta sessão, define senha, vincula escola (convite) ou
  // só redireciona (recuperação de senha)
  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirm) { setError('As senhas não coincidem.'); return; }
    if (password.length < 6)  { setError('A senha deve ter ao menos 6 caracteres.'); return; }
    if (!inviteTokens) {
      setError('Link expirado ou inválido. Peça um novo link.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Seta a sessão com os tokens do link (só agora, após o usuário digitar a senha)
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: inviteTokens.access,
        refresh_token: inviteTokens.refresh,
      });
      if (sessionError) {
        setError('Link inválido ou expirado. Peça um novo link.');
        setLoading(false);
        return;
      }

      // 2. Define a senha
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(getFriendlyErrorMessage(updateError));
        setLoading(false);
        return;
      }

      // Recuperação de senha não tem convite pra aceitar — só redireciona
      if (flowKind.current === 'recovery') {
        window.location.href = '/';
        return;
      }

      // 3. Chama edge function (service role) para vincular convite — RLS impediria acesso client-side
      // refreshSession garante token rotacionado pelo updateUser — getSession pode ter o token antigo
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshData.session) {
        setError('Erro ao renovar sessão. Tente fazer login novamente.');
        setLoading(false);
        return;
      }
      const accessToken = refreshData.session.access_token;

      const fnRes = await supabase.functions.invoke('accept-invite', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (fnRes.error) {
        console.error('accept-invite error:', fnRes.error);
        // Non-fatal if no invite found — redirect anyway
      } else if (fnRes.data?.error === 'no_invite') {
        console.warn('Nenhum convite pendente encontrado — redirecionando assim mesmo');
      }

      window.location.href = '/dashboard';

    } catch (err: any) {
      console.error('handleSetPassword error:', err);
      setError(getFriendlyErrorMessage(err, 'Ocorreu um erro inesperado. Tente novamente.'));
      setLoading(false);
    }
  };

  // Envia e-mail de recuperação de senha
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/auth`,
    });
    if (error) {
      setError(getFriendlyErrorMessage(error));
    } else {
      // Mensagem genérica de propósito — não confirma se o e-mail existe ou não
      setSuccess('Se esse e-mail estiver cadastrado, você vai receber um link para redefinir sua senha.');
    }
    setLoading(false);
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
    if (error) setError(getFriendlyErrorMessage(error));
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
    if (error) setError(getFriendlyErrorMessage(error));
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
              <h2 className="text-2xl font-bold tracking-tight">
                {flowKind.current === 'recovery' ? 'Redefinir senha' : 'Bem-vindo ao Class Cash!'}
              </h2>
              <p className="text-muted-foreground mt-1">
                {flowKind.current === 'recovery'
                  ? 'Escolha uma nova senha para sua conta.'
                  : 'Crie uma senha para acessar sua conta.'}
              </p>
            </div>
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nova senha</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPwd ? 'text' : 'password'}
                    placeholder="Mínimo 6 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPwd(!showNewPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showNewPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar senha</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPwd ? 'text' : 'password'}
                    placeholder="Repita a senha"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={6}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPwd(!showConfirmPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showConfirmPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
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

  // ── Tela: esqueci minha senha ──────────────────────────────────
  if (view === 'forgot') {
    return (
      <div className="min-h-screen flex">
        {leftPanel}
        <div className="flex-1 flex items-center justify-center p-6 bg-background">
          <div className="w-full max-w-md space-y-8">
            {mobileLogo}
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Recuperar senha</h2>
              <p className="text-muted-foreground mt-1">
                Informe seu e-mail e enviaremos um link para redefinir sua senha.
              </p>
            </div>
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="seu@email.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Enviando...' : 'Enviar link de recuperação'}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-foreground text-center"
                onClick={() => { setView('auth'); setError(null); setSuccess(null); }}
              >
                Voltar para o login
              </button>
            </form>
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
          <Tabs defaultValue={initialTab} className="w-full">
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
                  <div className="relative">
                    <Input
                      id="signin-password"
                      name="password"
                      type={showSignInPwd ? 'text' : 'password'}
                      placeholder="Sua senha"
                      required
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignInPwd(!showSignInPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showSignInPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Entrando...' : 'Entrar'}
                </Button>
                <button
                  type="button"
                  className="w-full text-sm text-muted-foreground hover:text-foreground text-center"
                  onClick={() => { setView('forgot'); setError(null); setSuccess(null); }}
                >
                  Esqueci minha senha
                </button>
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
                  <div className="relative">
                    <Input
                      id="signup-password"
                      name="password"
                      type={showSignUpPwd ? 'text' : 'password'}
                      placeholder="Crie uma senha (mín. 6 caracteres)"
                      required
                      disabled={loading}
                      minLength={6}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignUpPwd(!showSignUpPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showSignUpPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
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

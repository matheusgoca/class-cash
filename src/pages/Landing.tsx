// TODO: Revisar nome do produto antes do lançamento ("Class Cash")
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BarChart3,
  FileText,
  Users,
  TrendingUp,
  CheckCircle,
  ArrowRight,
  School,
  BookOpen,
  GraduationCap,
  Zap,
  Shield,
  Bell,
  Menu,
  X,
} from "lucide-react";

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="bg-primary rounded-lg p-1.5">
              <School className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">Class Cash</span>
          </div>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#funcionalidades" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Funcionalidades</a>
            <a href="#segmentos" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Para quem</a>
            <a href="#precos" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Preços</a>
            <a href="#faq" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">FAQ</a>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link to="/auth">
              <Button variant="ghost" size="sm">Entrar</Button>
            </Link>
            <Link to="/auth">
              <Button size="sm">Começar grátis</Button>
            </Link>
          </div>

          {/* Mobile menu button */}
          <button className="md:hidden" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden py-4 space-y-3 border-t border-gray-100">
            <a href="#funcionalidades" className="block text-sm text-gray-600 py-2" onClick={() => setMenuOpen(false)}>Funcionalidades</a>
            <a href="#segmentos" className="block text-sm text-gray-600 py-2" onClick={() => setMenuOpen(false)}>Para quem</a>
            <a href="#precos" className="block text-sm text-gray-600 py-2" onClick={() => setMenuOpen(false)}>Preços</a>
            <a href="#faq" className="block text-sm text-gray-600 py-2" onClick={() => setMenuOpen(false)}>FAQ</a>
            <div className="flex gap-3 pt-2">
              <Link to="/auth" className="flex-1"><Button variant="outline" className="w-full" size="sm">Entrar</Button></Link>
              <Link to="/auth" className="flex-1"><Button className="w-full" size="sm">Começar grátis</Button></Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="pt-28 pb-28 px-4" style={{ background: "linear-gradient(180deg, #EFF6FF 0%, #ffffff 60%)" }}>
      <div className="max-w-7xl mx-auto">
        <div className="text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm font-medium">
            🎉 Gestão financeira escolar simplificada
          </Badge>

          <h1 className="text-5xl sm:text-6xl font-extrabold text-gray-900 leading-tight mb-6">
            Chega de planilhas.<br />
            <span className="text-primary">Controle tudo</span> em um só lugar.
          </h1>

          <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto leading-relaxed">
            Gerencie mensalidades, contratos e inadimplência da sua escola de forma simples, rápida e profissional. Do lançamento ao recebimento.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/auth">
              <Button size="lg" className="px-8 h-12 text-base font-semibold">
                Começar grátis
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <a href="#funcionalidades">
              <Button size="lg" variant="outline" className="px-8 h-12 text-base">
                Ver funcionalidades
              </Button>
            </a>
          </div>

          <p className="text-sm text-gray-400 mt-4">Sem cartão de crédito · Cancele quando quiser</p>
        </div>

        {/* Dashboard preview */}
        <div className="mt-16 relative">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-100 px-4 py-3 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-400" />
              <div className="w-3 h-3 rounded-full bg-yellow-400" />
              <div className="w-3 h-3 rounded-full bg-green-400" />
              <div className="flex-1 mx-4 bg-gray-200 rounded-md h-5" />
            </div>
            <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Receita recebida", value: "R$ 48.200", color: "bg-blue-50 text-blue-600" },
                { label: "Mensalidades pendentes", value: "23", color: "bg-yellow-50 text-yellow-600" },
                { label: "Inadimplência", value: "4,2%", color: "bg-red-50 text-red-600" },
                { label: "Alunos ativos", value: "187", color: "bg-green-50 text-green-600" },
              ].map((card) => (
                <div key={card.label} className={`rounded-xl p-4 ${card.color}`}>
                  <p className="text-xs font-medium opacity-70 mb-1">{card.label}</p>
                  <p className="text-2xl font-bold">{card.value}</p>
                </div>
              ))}
            </div>
            <div className="px-6 pb-6 grid grid-cols-3 gap-3">
              {[60, 80, 45, 90, 70, 55, 85].map((h, i) => (
                <div key={i} className="hidden md:flex items-end gap-1 h-16">
                  {[h, h * 0.7, h * 1.1].map((v, j) => (
                    <div
                      key={j}
                      className="flex-1 rounded-t bg-primary/20"
                      style={{ height: `${Math.min(v, 100)}%` }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-3/4 h-12 bg-primary/10 blur-2xl rounded-full" />
        </div>
      </div>
    </section>
  );
}

// ─── Social proof ─────────────────────────────────────────────────────────────
function SocialProof() {
  const stats = [
    { value: "500+", label: "Escolas ativas" },
    { value: "R$ 2M+", label: "Gerenciados por mês" },
    { value: "98%", label: "Satisfação dos clientes" },
    { value: "24h", label: "Suporte disponível" },
  ];

  return (
    <section className="py-16 bg-white border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="text-4xl font-extrabold text-primary mb-1">{s.value}</p>
              <p className="text-sm text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Features ─────────────────────────────────────────────────────────────────
function Features() {
  const features = [
    {
      icon: FileText,
      color: "bg-blue-100 text-blue-600",
      title: "Contratos automáticos",
      description: "Crie contratos e gere mensalidades automaticamente para todo o período letivo, sem trabalho manual.",
    },
    {
      icon: BarChart3,
      color: "bg-violet-100 text-violet-600",
      title: "Dashboard financeiro",
      description: "Visualize receitas, inadimplência e saúde financeira de cada turma em tempo real.",
    },
    {
      icon: Bell,
      color: "bg-yellow-100 text-yellow-600",
      title: "Controle de inadimplência",
      description: "Identifique alunos em atraso e acompanhe mensalidades pendentes e vencidas com clareza.",
    },
    {
      icon: TrendingUp,
      color: "bg-green-100 text-green-600",
      title: "Relatórios e exportação",
      description: "Exporte relatórios financeiros completos em CSV ou Excel para análise ou contabilidade.",
    },
    {
      icon: Users,
      color: "bg-pink-100 text-pink-600",
      title: "Gestão de alunos e turmas",
      description: "Cadastre alunos, organize turmas e atribua professores com facilidade.",
    },
    {
      icon: Shield,
      color: "bg-cyan-100 text-cyan-600",
      title: "Segurança e multi-escola",
      description: "Cada escola tem seus dados isolados. Acesso seguro com autenticação e permissões por perfil.",
    },
  ];

  return (
    <section id="funcionalidades" className="py-24 px-4 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <Badge variant="secondary" className="mb-4">Funcionalidades</Badge>
          <h2 className="text-4xl font-extrabold text-gray-900 mb-4">
            Tudo que sua escola precisa
          </h2>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto">
            Do cadastro ao recebimento, o Class Cash cobre todo o ciclo financeiro escolar.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((f) => (
            <div key={f.title} className="group p-6 rounded-2xl border border-gray-200 bg-white hover:border-primary/30 hover:shadow-lg transition-all duration-200">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${f.color}`}>
                <f.icon className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{f.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Segments ─────────────────────────────────────────────────────────────────
function Segments() {
  const segments = [
    {
      icon: School,
      title: "Escolas Particulares",
      description: "Controle mensalidades, contratos anuais e inadimplência de centenas de alunos sem complicação.",
      items: ["Contratos por turma", "Geração automática de mensalidades", "Relatórios de receita"],
    },
    {
      icon: BookOpen,
      title: "Escolas de Idiomas",
      description: "Gerencie turmas por nível, semestres e diferentes valores de acordo com a carga horária.",
      items: ["Turmas por nível/idioma", "Descontos personalizados", "Controle de contratos"],
    },
    {
      icon: GraduationCap,
      title: "Cursos e Treinamentos",
      description: "Ideal para cursos livres, reforço escolar e preparatórios que cobram por módulo ou período.",
      items: ["Módulos flexíveis", "Múltiplos professores", "Dashboard por turma"],
    },
  ];

  return (
    <section id="segmentos" className="py-24 px-4 bg-white">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <Badge variant="secondary" className="mb-4">Para quem é</Badge>
          <h2 className="text-4xl font-extrabold text-gray-900 mb-4">
            Feito para quem ensina
          </h2>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto">
            Independente do tamanho ou segmento, o Class Cash se adapta à sua realidade.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 overflow-visible py-4">
          {segments.map((s, i) => (
            <div key={s.title} className={`rounded-2xl p-8 ${i === 1 ? "bg-primary text-white shadow-xl scale-105" : "bg-white border border-gray-100"}`}>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-6 ${i === 1 ? "bg-white/20" : "bg-primary/10"}`}>
                <s.icon className={`h-6 w-6 ${i === 1 ? "text-white" : "text-primary"}`} />
              </div>
              <h3 className={`text-xl font-bold mb-3 ${i === 1 ? "text-white" : "text-gray-900"}`}>{s.title}</h3>
              <p className={`text-sm leading-relaxed mb-6 ${i === 1 ? "text-white/80" : "text-gray-500"}`}>{s.description}</p>
              <ul className="space-y-2">
                {s.items.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm">
                    <CheckCircle className={`h-4 w-4 flex-shrink-0 ${i === 1 ? "text-white/80" : "text-primary"}`} />
                    <span className={i === 1 ? "text-white/90" : "text-gray-600"}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ──────────────────────────────────────────────────────────────────
function Pricing() {
  const plans = [
    {
      name: "Starter",
      price: "Grátis",
      period: "",
      description: "Para começar sem compromisso",
      highlight: false,
      items: [
        "Até 50 alunos",
        "1 turma",
        "Dashboard básico",
        "Exportação CSV",
        "Suporte por e-mail",
      ],
      cta: "Criar conta grátis",
    },
    {
      name: "Pro",
      price: "R$ 97",
      period: "/mês",
      description: "Para escolas em crescimento",
      highlight: true,
      items: [
        "Alunos ilimitados",
        "Turmas ilimitadas",
        "Dashboard avançado",
        "Exportação CSV e Excel",
        "Relatórios completos",
        "Suporte prioritário",
        "Contratos automáticos",
      ],
      cta: "Começar 14 dias grátis",
    },
    {
      name: "Enterprise",
      price: "Sob consulta",
      period: "",
      description: "Para redes e grandes instituições",
      highlight: false,
      items: [
        "Múltiplas unidades",
        "Multi-tenant",
        "Onboarding dedicado",
        "SLA garantido",
        "Integrações customizadas",
        "Gerente de conta",
      ],
      cta: "Falar com vendas",
    },
  ];

  return (
    <section id="precos" className="py-24 px-4 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <Badge variant="secondary" className="mb-4">Preços</Badge>
          <h2 className="text-4xl font-extrabold text-gray-900 mb-4">
            Simples e transparente
          </h2>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto">
            Sem taxas ocultas. Cancele quando quiser.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 items-center overflow-visible py-6">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-8 border ${
                plan.highlight
                  ? "border-primary shadow-2xl bg-primary text-white scale-105"
                  : "border-gray-200 bg-white"
              }`}
            >
              {plan.highlight && (
                <Badge className="bg-white text-primary mb-4 hover:bg-white">Mais popular</Badge>
              )}
              <h3 className={`text-xl font-bold mb-1 ${plan.highlight ? "text-white" : "text-gray-900"}`}>
                {plan.name}
              </h3>
              <p className={`text-sm mb-4 ${plan.highlight ? "text-white/70" : "text-gray-500"}`}>
                {plan.description}
              </p>
              <div className="flex items-end gap-1 mb-6">
                <span className={`text-4xl font-extrabold ${plan.highlight ? "text-white" : "text-gray-900"}`}>
                  {plan.price}
                </span>
                <span className={`text-sm mb-1 ${plan.highlight ? "text-white/70" : "text-gray-500"}`}>
                  {plan.period}
                </span>
              </div>

              <Link to="/auth">
                <Button
                  className={`w-full mb-8 ${
                    plan.highlight
                      ? "bg-white text-primary hover:bg-gray-100"
                      : ""
                  }`}
                  variant={plan.highlight ? "secondary" : "outline"}
                >
                  {plan.cta}
                </Button>
              </Link>

              <ul className="space-y-3">
                {plan.items.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm">
                    <CheckCircle className={`h-4 w-4 flex-shrink-0 ${plan.highlight ? "text-white/80" : "text-primary"}`} />
                    <span className={plan.highlight ? "text-white/90" : "text-gray-600"}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────
function FAQ() {
  const items = [
    {
      q: "Preciso de cartão de crédito para começar?",
      a: "Não. O plano Starter é 100% gratuito e não exige cartão de crédito. Você só precisa criar uma conta.",
    },
    {
      q: "Como funciona o período de teste do plano Pro?",
      a: "Você tem 14 dias de acesso completo ao plano Pro sem cobranças. Após o período, pode continuar no Pro ou voltar para o Starter.",
    },
    {
      q: "Meus dados estão seguros?",
      a: "Sim. Utilizamos isolamento completo por escola (multi-tenant), autenticação segura e backups automáticos. Cada escola só acessa os seus próprios dados.",
    },
    {
      q: "Posso importar dados de outro sistema?",
      a: "Sim, oferecemos importação via planilha CSV para alunos, turmas e contratos. Nossa equipe também pode auxiliar na migração.",
    },
    {
      q: "O sistema gera as mensalidades automaticamente?",
      a: "Sim. Ao criar um contrato, o sistema gera automaticamente todas as mensalidades do período com as datas de vencimento configuradas.",
    },
    {
      q: "Posso ter múltiplas unidades ou franquias?",
      a: "Sim, o plano Enterprise suporta múltiplas unidades com gestão centralizada. Entre em contato para saber mais.",
    },
    {
      q: "Existe aplicativo mobile?",
      a: "O Class Cash é um sistema web responsivo que funciona muito bem em celulares e tablets. Um app nativo está no nosso roadmap.",
    },
    {
      q: "Como funciona o suporte?",
      a: "O plano Starter tem suporte por e-mail. O Pro tem suporte prioritário com resposta em até 4 horas. O Enterprise conta com gerente de conta dedicado.",
    },
  ];

  return (
    <section id="faq" className="py-24 px-4 bg-white">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-16">
          <Badge variant="secondary" className="mb-4">FAQ</Badge>
          <h2 className="text-4xl font-extrabold text-gray-900 mb-4">
            Perguntas frequentes
          </h2>
          <p className="text-lg text-gray-500">
            Não encontrou o que procurava? <a href="mailto:contato@classcash.com.br" className="text-primary hover:underline">Fale conosco</a>.
          </p>
        </div>

        <Accordion type="single" collapsible className="space-y-3">
          {items.map((item, i) => (
            <AccordionItem
              key={i}
              value={`item-${i}`}
              className="bg-white border border-gray-100 rounded-xl px-6 data-[state=open]:shadow-sm"
            >
              <AccordionTrigger className="text-left font-medium text-gray-900 hover:no-underline py-5">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-gray-500 text-sm leading-relaxed pb-5">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

// ─── CTA Final ────────────────────────────────────────────────────────────────
function CTAFinal() {
  return (
    <section className="py-24 px-4 bg-primary">
      <div className="max-w-3xl mx-auto text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/20 mb-8">
          <Zap className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-4xl font-extrabold text-white mb-4">
          Pronto para organizar as finanças da sua escola?
        </h2>
        <p className="text-white/70 text-lg mb-10">
          Junte-se a centenas de escolas que já simplificaram sua gestão financeira com o Class Cash.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/auth">
            <Button size="lg" className="bg-white text-primary hover:bg-gray-100 px-8 h-12 font-semibold">
              Criar conta grátis
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
        <p className="text-white/50 text-sm mt-4">Sem cartão de crédito · Setup em minutos</p>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="py-12 px-4 bg-gray-900 text-gray-400">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="bg-primary rounded-lg p-1.5">
                <School className="h-4 w-4 text-white" />
              </div>
              <span className="text-white font-bold">Class Cash</span>
            </div>
            <p className="text-sm max-w-xs">
              Gestão financeira escolar simples, rápida e confiável.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-8 text-sm">
            <div>
              <p className="text-white font-medium mb-3">Produto</p>
              <ul className="space-y-2">
                <li><a href="#funcionalidades" className="hover:text-white transition-colors">Funcionalidades</a></li>
                <li><a href="#precos" className="hover:text-white transition-colors">Preços</a></li>
                <li><a href="#faq" className="hover:text-white transition-colors">FAQ</a></li>
              </ul>
            </div>
            <div>
              <p className="text-white font-medium mb-3">Empresa</p>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-white transition-colors">Sobre nós</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contato</a></li>
              </ul>
            </div>
            <div>
              <p className="text-white font-medium mb-3">Legal</p>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-white transition-colors">Privacidade</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Termos de uso</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-8 text-sm text-center">
          © {new Date().getFullYear()} Class Cash. Todos os direitos reservados.
        </div>
      </div>
    </footer>
  );
}

// ─── Main Landing Page ────────────────────────────────────────────────────────
const Landing = () => {
  return (
    <div className="min-h-screen">
      <Navbar />
      <Hero />
      <SocialProof />
      <Features />
      <Segments />
      <Pricing />
      <FAQ />
      <CTAFinal />
      <Footer />
    </div>
  );
};

export default Landing;

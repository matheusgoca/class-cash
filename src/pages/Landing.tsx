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
  FileText,
  Receipt,
  Bell,
  History,
  TrendingUp,
  CheckCircle,
  ArrowRight,
  School,
  Menu,
  X,
} from "lucide-react";

const CONTACT_MAILTO = "mailto:matheusgoca@gmail.com?subject=Quero%20conhecer%20o%20Class%20Cash";

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="bg-primary rounded-lg p-1.5">
              <School className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">Class Cash</span>
          </div>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#como-ajuda" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Como ajuda</a>
            <a href="#para-quem" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Para quem é</a>
            <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Perguntas</a>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link to="/auth">
              <Button variant="outline" size="sm">Entrar</Button>
            </Link>
          </div>

          {/* Mobile menu button */}
          <button className="md:hidden" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden py-4 space-y-3 border-t border-border">
            <a href="#como-ajuda" className="block text-sm text-muted-foreground py-2" onClick={() => setMenuOpen(false)}>Como ajuda</a>
            <a href="#para-quem" className="block text-sm text-muted-foreground py-2" onClick={() => setMenuOpen(false)}>Para quem é</a>
            <a href="#faq" className="block text-sm text-muted-foreground py-2" onClick={() => setMenuOpen(false)}>Perguntas</a>
            <div className="pt-2">
              <Link to="/auth" className="block"><Button variant="outline" className="w-full" size="sm">Entrar</Button></Link>
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
    <section className="pt-28 pb-20 px-4 bg-gradient-to-b from-primary/[0.07] via-background to-background">
      <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm font-medium">
            Gestão financeira para escolas particulares
          </Badge>

          <h1 className="text-4xl sm:text-5xl font-extrabold text-foreground leading-tight mb-6">
            Saiba quanto sua escola <span className="text-primary">realmente ganha</span>, turma por turma.
          </h1>

          <p className="text-lg text-muted-foreground mb-8 max-w-lg leading-relaxed">
            Mensalidades, inadimplência, salários e despesas num só lugar. Feito para escolas do infantil ao ensino médio, sem planilha espalhada e sem fim de mês no escuro.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <a href={CONTACT_MAILTO}>
              <Button size="lg" className="px-8 h-12 text-base font-semibold w-full sm:w-auto">
                Conversar com a gente
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
            <a href="#como-ajuda">
              <Button size="lg" variant="outline" className="px-8 h-12 text-base w-full sm:w-auto">
                Ver como funciona
              </Button>
            </a>
          </div>

          <p className="text-sm text-muted-foreground mt-4">Sem cartão de crédito para começar a conversa.</p>
        </div>

        {/* Tela ilustrativa — usa as mesmas cores de status do app de verdade
            (success/warning/danger), não um arco-íris decorativo sem relação com o produto */}
        <div className="bg-card rounded-2xl shadow-2xl border border-border p-6">
          <p className="text-sm text-muted-foreground">Saldo financeiro do mês</p>
          <p className="text-3xl font-bold text-success mb-4">R$ 18.420,00</p>
          <div className="space-y-2.5">
            {[
              { label: "5º Ano A", status: "Excelente", color: "bg-success-light text-success" },
              { label: "2º Ano B", status: "Atenção", color: "bg-warning-light text-warning" },
              { label: "Pré II", status: "Crítico", color: "bg-danger-light text-danger" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between border border-border rounded-lg px-3 py-2.5">
                <span className="text-sm font-semibold text-foreground">{row.label}</span>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${row.color}`}>{row.status}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">Tela ilustrativa com dados de exemplo.</p>
        </div>
      </div>
    </section>
  );
}

// ─── Problems (copy por problema) ─────────────────────────────────────────────
function Problems() {
  const problems = [
    {
      icon: Bell,
      title: "Quem está inadimplente?",
      description: "Veja o que venceu, quanto é e de qual turma, sem cruzar listas. Renegocie direto da cobrança.",
    },
    {
      icon: TrendingUp,
      title: "Essa turma dá lucro?",
      description: "O custo de professores e das despesas é dividido entre as turmas, e você vê o resultado de cada uma.",
    },
    {
      icon: Receipt,
      title: "Quanto sobrou este mês?",
      description: "Receita recebida menos salários e despesas, com comparação com o mês anterior.",
    },
  ];

  return (
    <section id="como-ajuda" className="py-24 px-4 bg-muted/40">
      <div className="max-w-7xl mx-auto">
        <div className="mb-12">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">
            Perguntas que todo dono de escola se faz
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl">
            E que, hoje, costumam levar uma tarde inteira de planilha para responder.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {problems.map((p) => (
            <div key={p.title} className="p-6 rounded-2xl border border-border bg-card">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 bg-primary/10 text-primary">
                <p.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">{p.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{p.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── O que você controla ──────────────────────────────────────────────────────
function Features() {
  const features = [
    {
      icon: FileText,
      title: "Alunos, turmas e contratos",
      description: "Matrículas com valor, desconto e vencimento. As mensalidades são geradas para você.",
    },
    {
      icon: Receipt,
      title: "Despesas e recorrências",
      description: "Aluguel, luz, material: cadastre uma vez e o sistema lança todo mês.",
    },
    {
      icon: Bell,
      title: "Lembretes no momento certo",
      description: "Avisos de vencimento, renegociação e rematrícula, no sistema e por e-mail.",
    },
    {
      icon: History,
      title: "Histórico de alterações",
      description: "Saiba quem mudou o quê e quando, com registro que ninguém consegue apagar.",
    },
  ];

  return (
    <section className="py-24 px-4 bg-background">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-12">
          O que você controla no Class Cash
        </h2>

        <div className="grid md:grid-cols-2 gap-8">
          {features.map((f) => (
            <div key={f.title} className="flex gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground mb-1">{f.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Para quem é ──────────────────────────────────────────────────────────────
function Segments() {
  const levels = ["Educação Infantil", "Fundamental I e II", "Ensino Médio"];

  return (
    <section id="para-quem" className="py-24 px-4 bg-primary/5">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">
          Feito para a rotina da escola particular
        </h2>
        <p className="text-lg text-muted-foreground max-w-2xl mb-8">
          Nosso foco são escolas do infantil ao ensino médio. Cursos técnicos e de idiomas também usam, com as adaptações que fizerem sentido.
        </p>
        <div className="flex gap-3 flex-wrap">
          {levels.map((level) => (
            <span key={level} className="px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-semibold text-sm">
              {level}
            </span>
          ))}
          <span className="px-5 py-2.5 rounded-full bg-card border border-primary/30 text-primary text-sm">
            Também atende: técnico e idiomas
          </span>
        </div>
      </div>
    </section>
  );
}

// ─── Como começar ─────────────────────────────────────────────────────────────
function HowToStart() {
  const steps = [
    {
      number: "1",
      title: "Cadastre ou importe",
      description: "Turmas, professores e alunos, um a um ou por planilha.",
    },
    {
      number: "2",
      title: "Crie os contratos",
      description: "As mensalidades e os vencimentos nascem sozinhos.",
    },
    {
      number: "3",
      title: "Acompanhe o painel",
      description: "Saldo, atrasos e saúde de cada turma, atualizados todo dia.",
    },
  ];

  return (
    <section className="py-24 px-4 bg-background">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-12">
          Como começar
        </h2>
        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((step) => (
            <div key={step.number} className="p-6 rounded-2xl border border-border bg-card">
              <div className="text-sm font-bold text-brand-accent mb-2">{step.number}</div>
              <h3 className="text-base font-semibold text-foreground mb-1.5">{step.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Depoimento ────────────────────────────────────────────────────────────────
// Sem números ou depoimentos inventados: espaço reservado para depoimento real
// quando houver autorização da escola piloto.
function Testimonial() {
  return (
    <section className="py-16 px-4 bg-muted/40">
      <div className="max-w-5xl mx-auto bg-card border border-border rounded-2xl p-8 flex flex-col md:flex-row gap-6 items-center justify-between">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground mb-2">Nasceu dentro de uma escola de verdade</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            O Class Cash foi criado para resolver o financeiro de uma escola particular familiar, que é a primeira usuária em produção. [DEPOIMENTO REAL — adicionar quando houver autorização]
          </p>
        </div>
        <a href={CONTACT_MAILTO}>
          <Button size="lg" className="whitespace-nowrap">Quero conhecer</Button>
        </a>
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────
function FAQ() {
  const items = [
    {
      q: "Preciso trocar o sistema que já uso para a secretaria?",
      a: "Não. O Class Cash cuida do financeiro e pode conviver com o seu sistema acadêmico.",
    },
    {
      q: "Consigo trazer meus dados de planilha?",
      a: "Sim. Há modelos de planilha para turmas, professores, alunos e matrículas.",
    },
    {
      q: "Os dados da minha escola ficam separados dos de outras?",
      a: "Sim. Cada escola enxerga apenas os próprios dados.",
    },
  ];

  return (
    <section id="faq" className="py-24 px-4 bg-background">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-3xl font-extrabold text-foreground mb-8">
          Perguntas frequentes
        </h2>

        <Accordion type="single" collapsible className="space-y-3">
          {items.map((item, i) => (
            <AccordionItem
              key={i}
              value={`item-${i}`}
              className="bg-card border border-border rounded-xl px-6 data-[state=open]:shadow-sm"
            >
              <AccordionTrigger className="text-left font-medium text-foreground hover:no-underline py-5">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-sm leading-relaxed pb-5">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  return (
    // bg-foreground/text-background dão o "sempre escuro" no light mode, mas
    // esses tokens INVERTEM de sentido no dark mode (foreground vira claro,
    // background vira escuro) — sem os overrides dark: explícitos, o rodapé
    // virava uma faixa branca com texto escuro em vez de continuar escuro.
    <footer className="py-8 px-4 bg-foreground text-background/60 dark:bg-background dark:text-muted-foreground dark:border-t dark:border-border">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3 text-sm">
        <span>Class Cash · gestão financeira para escolas</span>
        <div className="flex items-center gap-4">
          <a href="mailto:matheusgoca@gmail.com" className="hover:text-background dark:hover:text-foreground transition-colors">Contato</a>
          <Link to="/termos" className="hover:text-background dark:hover:text-foreground transition-colors">Termos</Link>
          <Link to="/privacidade" className="hover:text-background dark:hover:text-foreground transition-colors">Privacidade</Link>
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
      <Problems />
      <Features />
      <Segments />
      <HowToStart />
      <Testimonial />
      <FAQ />
      <Footer />
    </div>
  );
};

export default Landing;

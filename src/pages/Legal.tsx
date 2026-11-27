import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

function LegalPage({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-white px-4 py-16">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
        <p className="text-gray-600 leading-relaxed">
          Este documento ainda está em elaboração. Para dúvidas sobre como tratamos seus dados
          ou os termos de uso do Class Cash, fale com a gente em{" "}
          <a href="mailto:contato@classcash.com.br" className="text-primary hover:underline">
            contato@classcash.com.br
          </a>.
        </p>
      </div>
    </div>
  );
}

export function PrivacyPolicy() {
  return <LegalPage title="Política de Privacidade" />;
}

export function TermsOfUse() {
  return <LegalPage title="Termos de Uso" />;
}

const Settings = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">
          Configure as preferências do sistema
        </p>
      </div>

      <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4">Configurações do Sistema</h2>
        <p className="text-muted-foreground">
          Funcionalidade em desenvolvimento. Em breve você poderá personalizar as configurações do sistema.
        </p>
      </div>
    </div>
  );
};

export default Settings;
# Mockups — Class Cash (sprints S1–S4)

Canvas online: https://claude.ai/artifact/2fEgRBzPVPJUvYUxEE4dQu

Os arquivos `.dc.html` são as telas do canvas de design. Abrem no navegador como HTML estático (sem o `support.js` do canvas, mas o layout renderiza). Servem de **referência visual** para implementar em React + Tailwind/shadcn; não são código de produção. Dados são ilustrativos.

Tokens de marca (de `src/index.css`): primária `hsl(173 64% 26%)` ≈ `#186D63`; accent `hsl(21 66% 40%)` ≈ `#A95223`; sucesso/atenção/crítico como nos cards de saúde da turma. Ao implementar, usar as variáveis do tema e os componentes `ui/` existentes, não os hex.

| Sprint | Arquivo | Tela |
|---|---|---|
| S1 | `LP.dc.html` | Landing page com novo tom |
| S2 | `Config-Escola.dc.html` | Configurações: escola e segmentos (série da turma filtrada pelo segmento) |
| S2 | `Config-Notificacoes-Seguranca.dc.html` | Preferências de notificação, troca de senha em etapas, 2FA TOTP |
| S2 | `Historico-Owner.dc.html` | Histórico de alterações (owner) |
| S2 | `Historico-Master.dc.html` | Histórico global (master admin) |
| S2 | `Master-Escolas.dc.html` | Painel master: escolas e mistura por segmento |
| S3 | `Main.dc.html` | Dashboard com sino e card "Precisa da sua atenção hoje" |
| S3 | `Notificacoes.dc.html` | Central de notificações |

Plano completo: `docs/PLANO_SPRINTS_NOV2026.md`.

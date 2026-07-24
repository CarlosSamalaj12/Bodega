import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useAuthStore } from '@/stores/auth.store';
import './HomePage.scss';

export function HomePage() {
  const user = useAuthStore((s) => s.user);

  return (
    <>
      <Header
        title="Inicio"
        subtitle={`Bienvenido, ${user?.full_name || user?.username || 'usuario'}`}
      />
      <div className="home-page">
        <Card
          title="Migración a React en curso"
          subtitle="Esta es la nueva interfaz. Se construye por secciones."
          accent
        >
          <p>
            El frontend se está migrando sección por sección. Mientras tanto,
            algunas pantallas siguen funcionando en la versión original.
          </p>
          <div className="home-page__tags">
            <Badge variant="accent">React 19</Badge>
            <Badge variant="info">Vite</Badge>
            <Badge variant="success">Sass</Badge>
            <Badge>Zustand</Badge>
            <Badge variant="warning">Socket.IO</Badge>
          </div>
        </Card>

        <div className="home-page__grid">
          <Card title="Backend" subtitle="Sin cambios">
            <p>
              Tu servidor Express + MariaDB sigue intacto. React habla con él
              a través del proxy de Vite.
            </p>
          </Card>
          <Card title="Diseño" subtitle="Sistema en Sass">
            <p>
              Tokens, variables y mixins centralizados en
              <code> src/styles/abstracts/</code>. Cada componente tiene su
              propio partial.
            </p>
          </Card>
          <Card title="Próximos pasos" subtitle="Por sección">
            <p>
              Entradas → Salidas → Pedidos → Productos. Cada una se valida
              antes de reemplazar la versión vanilla.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

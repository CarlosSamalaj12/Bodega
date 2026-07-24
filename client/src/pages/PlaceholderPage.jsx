import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export function PlaceholderPage({ title, section }) {
  return (
    <>
      <Header title={title} subtitle="Próximamente migrado a React" />
      <div style={{ padding: '24px' }}>
        <Card
          title={title}
          subtitle="Esta sección aún no se ha migrado"
          accent
        >
          <p>
            Estamos migrando sección por sección.{' '}
            <strong>{title}</strong> usa todavía la versión original de JavaScript.
          </p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <Badge variant="warning">En cola</Badge>
            <Badge variant="info">Sección: {section}</Badge>
          </div>
        </Card>
      </div>
    </>
  );
}

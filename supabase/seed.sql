-- ============================================================================
-- Datos de demostracion (los mismos del prototipo HTML).
-- Ejecutar DESPUES de 0001_init.sql. Opcional.
-- ============================================================================

insert into public.transactions (type, amount, category, party, concept, payment, author, notes, occurred_at) values
  ('Ingreso', 500.00, 'Ventas',            'Cliente Juan Pérez',       'Millar de volantes A6 couche 150g',        'Yape/Plin',     'María López (Admin)', 'Transferido a la cuenta Yape de empresa.', now() - interval '6 hour'),
  ('Egreso',  350.00, 'Materiales',        'Proveedor Pacheco S.A.C.', 'Compra de cartulina e insumos de imprenta','Transferencia', 'María López (Admin)', 'Factura F001-8392 adjunta.',               now() - interval '5 hour'),
  ('Ingreso', 240.00, 'Ventas',            'Cliente Cristina',         '1,000 afiches A3 full color',              'Efectivo',      'María López (Admin)', 'Entregado en mostrador principal.',        now() - interval '4 hour'),
  ('Ingreso', 400.00, 'Servicios',         'Imprenta Express',         'Anillado y empastado de tomos',            'Yape/Plin',     'María López (Admin)', 'Pago verificado en app Yape.',             now() - interval '2 hour'),
  ('Egreso',  210.00, 'Servicios Básicos', 'Luz del Sur / Enel',       'Pago mensual recibo de luz local',         'Efectivo',      'María López (Admin)', 'Pagado con efectivo de caja chica.',       now() - interval '1 hour');

insert into public.proformas (client, detail, total, validity_days) values
  ('Importadora San José',  '5,000 Folletos couche + Gigantografía 3x2m',        680.00, 15),
  ('Corporación Vega',      'Diseño gráfico y manual de marca institucional',    450.00, 7),
  ('Restaurante El Sabor',  '10 Cartas menú acrílicas e impresiones en vinil',   290.00, 30);

with nueva as (
  insert into public.debts (kind, party, concept, total) values
    ('COBRAR', 'Constructora del Centro', 'Saldo pendiente por impresión de planos', 600.00),
    ('COBRAR', 'Librería escolar Luz',    'Afiches de campaña escolar',              450.00),
    ('PAGAR',  'Papelera Lima S.A.',      'Insumos de papel bond 75g',               320.00)
  returning id, party
)
insert into public.debt_payments (debt_id, amount, payment_method)
select id, 200.00, 'Efectivo' from nueva where party = 'Constructora del Centro';

# Especificação de Segurança Firestore — Atelier Anne Caroline

## 1. Invariantes de Dados
1. **Isolamento de PII**: Documentos em `/clients/{clientId}` e `/appointments/{appointmentId}` contêm dados pessoais (`phone`, `email`, `clientPhone`, `clientEmail`). Somente o próprio titular (`clientId == request.auth.uid`) ou a proprietária (`isAdmin()`) pode ler esses documentos.
2. **Projeção Pública Segura de Horários**: O calendário lê `/slots/{slotId}` (sem PII) e `/closures/{closureId}` para exibir horários ocupados e dias fechados para clientes autenticadas.
3. **Regra de 1 Horário por Dia por Cliente**: A criação de um agendamento em `/appointments/{appointmentId}` exige criação atômica (batch) de `/slots/{slotId}` e `/clientDayLocks/{clientId}_{date}` onde o lock não pode existir previamente.
4. **Bloqueio de Dias Fechados**: Clientes não podem criar agendamentos se existir bloqueio de dia (`/closures/day_{date}`) ou horário (`/closures/slot_{slotId}`).
5. **Trava de Estado Terminal**: Uma vez que um agendamento atinge status `completed` ou `cancelled`, a cliente não pode alterá-lo novamente; apenas a proprietária (`isAdmin()`) pode gerenciar estados administrativos.
6. **Integridade Temporal**: Todos os campos `createdAt` e `updatedAt` são validados estritamente contra `request.time`.
7. **Relatório Financeiro Restrito**: A coleção `/finances/{financeId}` e as configurações em `/studio/{configId}` (escrita) são exclusivamente acessíveis pela proprietária (`isAdmin()`).

## 2. "Dirty Dozen" Payloads (12 Vetores de Ataque Bloqueados)
1. **Shadow Field Injection em `/clients`**: Enviar `role: "admin"` ou `isAdmin: true` durante o cadastro da cliente -> Bloqueado por `hasOnly(...)`.
2. **ID Poisoning em `/appointments`**: Usar um `appointmentId` de 1500 caracteres ou com caracteres inválidos (`../admin`) -> Bloqueado por `isValidId()`.
3. **Spoofing de Identidade em `/appointments`**: Cliente A tenta criar agendamento com `clientId: "cliente_B"` -> Bloqueado por `incoming().clientId == request.auth.uid`.
4. **Duplo Agendamento no Mesmo Dia**: Cliente A tenta agendar um segundo horário no mesmo dia sem passar pelo lock `/clientDayLocks/{uid}_{date}` -> Bloqueado por `existsAfter(...)` e unicidade do documento lock.
5. **Leitura de PII em `/clients` por Terceiro**: Cliente A tenta ler `/clients/cliente_B` -> Bloqueado por `isOwner(clientId) || isAdmin()`.
6. **Listagem Blanket de `/appointments`**: Cliente A tenta listar todos os agendamentos sem filtro `where('clientId', '==', uid)` -> Bloqueado por `resource.data.clientId == request.auth.uid`.
7. **Email Spoofing em Admin**: Usuário com `email: "egabi4125@gmail.com"` mas `email_verified: false` tenta acessar `/finances` -> Bloqueado por `request.auth.token.email_verified == true`.
8. **Alteração de Preço / Status para `paid` pela Cliente**: Cliente tenta atualizar `servicePrice` para `0` ou `paymentStatus` para `'paid'` -> Bloqueado por `affectedKeys().hasOnly(['status', 'cancellationType', 'cancellationFee', 'paymentStatus', 'updatedAt'])` e verificação de status `'cancelled'`.
9. **Reabertura de Agendamento Cancelado**: Cliente tenta reverter agendamento com `status: 'cancelled'` de volta para `'confirmed'` -> Bloqueado pela trava de estado terminal (`existing().status == 'confirmed'`).
10. **Falsificação de Timestamp**: Enviar `createdAt` retroativo no cliente -> Bloqueado por `incoming().createdAt == request.time`.
11. **Escrita em `/finances` por Cliente**: Cliente tenta inserir registro financeiro falso -> Bloqueado por `isAdmin()`.
12. **Escalação de Privilégio em `/admins`**: Cliente tenta criar `/admins/{uid}` sem a chave da proprietária -> Bloqueado por validação estrita de `username` e `passkey`.

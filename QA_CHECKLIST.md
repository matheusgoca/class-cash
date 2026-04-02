# QA Testing Checklist

## Schema Synchronization Testing Guide

This checklist ensures all application code correctly interacts with the Supabase database schema.

---

## Pre-Testing Setup

- [ ] Database has latest migrations applied
- [ ] Application deployed with updated code
- [ ] Test user has appropriate role (admin/financial for full access)
- [ ] Browser cache cleared
- [ ] Console open to monitor for errors

---

## 1. Student Management Testing

### Create Student
- [ ] Navigate to "Gestão de Alunos"
- [ ] Click "Novo Aluno" button
- [ ] Fill all required fields:
  - [ ] Nome Completo (at least 2 chars)
  - [ ] Email (valid format)
  - [ ] Telefone (at least 10 chars)
  - [ ] Data de Nascimento (valid date)
  - [ ] Data de Matrícula (defaults to today)
  - [ ] Contato do Responsável (at least 10 chars)
  - [ ] Turma (select from dropdown or leave empty)
  - [ ] Valor da Mensalidade (e.g., 500.00)
  - [ ] Desconto % (e.g., 10)
  - [ ] Status (Ativo/Inativo)
- [ ] **Verify:** Final tuition value calculates correctly in real-time
  - Example: R$ 500.00 - 10% = R$ 450.00
- [ ] Click "Criar"
- [ ] **Expected:** Success toast appears
- [ ] **Expected:** New student appears in table
- [ ] **Verify:** Student record in database has:
  - [ ] `final_tuition_value = 450.00`
  - [ ] `discount = 10`
  - [ ] `full_tuition_value = 500`
  - [ ] All other fields populated correctly

### Edit Student
- [ ] Click edit icon on a student row
- [ ] Change discount from 10% to 20%
- [ ] **Verify:** Final value updates immediately (500 * 0.8 = 400)
- [ ] Change base value from 500 to 600
- [ ] **Verify:** Final value updates (600 * 0.8 = 480)
- [ ] Click "Atualizar"
- [ ] **Expected:** Success toast
- [ ] **Expected:** Table updates with new values
- [ ] **Verify:** Database record updated correctly

### Delete Student
- [ ] Click delete icon (trash)
- [ ] Confirm deletion in dialog
- [ ] **Expected:** Success toast
- [ ] **Expected:** Student removed from table
- [ ] **Verify:** Student deleted from database

### Filter & Search
- [ ] Enter partial name in search box
- [ ] **Expected:** Table filters in real-time
- [ ] Select specific class in filter dropdown
- [ ] **Expected:** Only students from that class shown
- [ ] Select "Todas as turmas"
- [ ] **Expected:** All students visible again

### Validation Testing
- [ ] Try creating student without required fields
- [ ] **Expected:** Validation errors appear
- [ ] Enter invalid email format
- [ ] **Expected:** Email validation error
- [ ] Enter discount > 100
- [ ] **Expected:** Discount validation error
- [ ] Enter negative tuition value
- [ ] **Expected:** Validation error

---

## 2. Class Management Testing

### Create Class
- [ ] Navigate to "Gestão de Turmas"
- [ ] Click "Nova Turma"
- [ ] Fill all fields:
  - [ ] Nome da Turma (e.g., "1º Ano A")
  - [ ] Série/Ano (select from dropdown, e.g., "1º Ano")
  - [ ] Descrição (optional text)
  - [ ] Professor Responsável (select from dropdown)
  - [ ] Mensalidade da Turma (e.g., 15000.00)
  - [ ] Mensalidade por Aluno (e.g., 500.00)
  - [ ] Capacidade Máxima (e.g., 30)
  - [ ] Cor da Turma (select color)
- [ ] Click "Criar"
- [ ] **Expected:** Success toast
- [ ] **Expected:** New class appears in table
- [ ] **Verify:** Class record has all fields populated

### Edit Class
- [ ] Click edit icon on a class
- [ ] Change grade and fees
- [ ] Click "Atualizar"
- [ ] **Expected:** Success toast
- [ ] **Expected:** Table reflects changes

### Delete Class
- [ ] Try deleting a class WITH students
- [ ] **Expected:** Error message preventing deletion
- [ ] Create new empty class
- [ ] Delete the empty class
- [ ] **Expected:** Success toast
- [ ] **Expected:** Class removed

### Capacity & Revenue Display
- [ ] **Verify:** Student count shows correctly (X/30)
- [ ] **Verify:** "Receita Total" = mensalidade por aluno × student count
- [ ] **Verify:** Status badge shows:
  - [ ] "Disponível" if < 70% full (green)
  - [ ] "Moderada" if 70-90% full (yellow)
  - [ ] "Quase Lotada" if > 90% full (red)

---

## 3. Teacher Management Testing

### Create Teacher
- [ ] Navigate to "Gestão de Professores"
- [ ] Click "Novo Professor"
- [ ] Fill all fields:
  - [ ] Nome Completo (required)
  - [ ] Email (required, valid format)
  - [ ] Telefone (optional)
  - [ ] Especialização (select from dropdown)
  - [ ] Salário (e.g., 3000.00)
  - [ ] Status (Ativo/Inativo)
- [ ] Click "Criar"
- [ ] **Expected:** Success toast
- [ ] **Expected:** Teacher appears in table with salary formatted

### Edit Teacher
- [ ] Click edit icon
- [ ] Update salary and phone
- [ ] Click "Atualizar"
- [ ] **Expected:** Success toast
- [ ] **Verify:** Changes reflected in table

### Delete Teacher
- [ ] Try deleting teacher assigned to a class
- [ ] **Expected:** Error preventing deletion
- [ ] Create new teacher not assigned to any class
- [ ] Delete that teacher
- [ ] **Expected:** Success

### Display Verification
- [ ] **Verify:** Salary displays as formatted currency (R$ 3.000,00)
- [ ] **Verify:** Email and phone both visible in table
- [ ] **Verify:** Specialization displays correctly

---

## 4. Contract Management Testing

### Create Contract
- [ ] Navigate to "Gestão de Contratos"
- [ ] Click "Novo Contrato"
- [ ] Fill all fields:
  - [ ] Select student (required)
  - [ ] Select class (optional)
  - [ ] Start date (required)
  - [ ] End date (required, >= start date)
  - [ ] Monthly amount (required, > 0)
  - [ ] Discount % (optional, 0-100)
  - [ ] Status (default: active)
- [ ] Click "Criar"
- [ ] **Expected:** Success toast
- [ ] **Expected:** Contract appears in summary cards and table

### Verify Tuition Auto-Generation
- [ ] After creating active contract
- [ ] Navigate to "Gestão de Mensalidades"
- [ ] **Expected:** Tuitions automatically created for contract period
- [ ] **Verify:** Each tuition has:
  - [ ] `contract_id` linked to contract
  - [ ] `amount` = contract monthly_amount
  - [ ] `discount_applied` = amount × discount%
  - [ ] `final_amount` = amount - discount_applied
  - [ ] `due_date` = last day of each month in range
  - [ ] `status` = pending
  - [ ] `description` = "Mensalidade MM/YYYY"

### Contract Status Changes
- [ ] Edit contract and change status to "suspended"
- [ ] **Verify:** No new tuitions generated for future months
- [ ] Change status to "active" again
- [ ] **Verify:** Tuitions generated for remaining period
- [ ] Change status to "cancelled"
- [ ] **Verify:** No future tuitions generated

### Contract Summary Cards
- [ ] **Verify:** "Total" shows count and total monthly revenue
- [ ] **Verify:** "Ativos" shows active count and revenue
- [ ] **Verify:** "Suspensos" shows suspended count
- [ ] **Verify:** "Cancelados" shows cancelled count

---

## 5. Tuition Management Testing

### View Tuitions
- [ ] Navigate to "Gestão de Mensalidades"
- [ ] **Verify:** Tuition table shows:
  - [ ] Student name (from join)
  - [ ] Class name (from nested join)
  - [ ] Due date (formatted dd/MM/yyyy)
  - [ ] Base amount
  - [ ] Discount applied
  - [ ] Penalty (if any)
  - [ ] Final amount
  - [ ] Status badge (color-coded)

### Mark as Paid
- [ ] Click dropdown on a pending tuition
- [ ] Select "Marcar como Pago"
- [ ] **Expected:** Payment dialog opens
- [ ] Select payment method
- [ ] Click confirm
- [ ] **Expected:** Success toast
- [ ] **Verify:** Tuition record updated:
  - [ ] `status = 'paid'`
  - [ ] `paid_date = today`
  - [ ] `payment_method` = selected value

### Overdue Detection
- [ ] Find or create a tuition with `due_date` in the past
- [ ] Keep `status = 'pending'`
- [ ] **Verify:** UI displays status as "Atrasado" (red badge)
- [ ] **Verify:** Database `status` still shows 'pending' (not auto-changed)
- [ ] Summary card "Atrasados" includes this tuition

### Apply Discount/Penalty
- [ ] Edit a tuition
- [ ] Add penalty amount (e.g., 50.00)
- [ ] **Verify:** Final amount recalculates:
  - `final_amount = amount - discount_applied + penalty_amount`
- [ ] Save changes
- [ ] **Expected:** Table shows updated final amount

### Tuition Summary Cards
- [ ] **Verify:** "Total" shows all tuitions count and total amount
- [ ] **Verify:** "Pendentes" shows pending count and amount (yellow)
- [ ] **Verify:** "Pagos" shows paid count and amount (green)
- [ ] **Verify:** "Atrasados" shows overdue count and amount (red)

---

## 6. Dashboard Testing

### Financial Metrics
- [ ] Navigate to Dashboard ("Dashboard Financeiro")
- [ ] **Verify:** Top metric cards show:
  - [ ] Total students count
  - [ ] Total revenue (from paid tuitions)
  - [ ] Pending revenue
  - [ ] Overdue revenue

### Class Health Cards
- [ ] **Verify:** Each class shows:
  - [ ] Class name and color indicator
  - [ ] Payment percentage (paid/total students)
  - [ ] Status badge (Excellent/Good/Warning/Critical)
  - [ ] Total and paid revenue amounts

### Charts
- [ ] **Verify:** Revenue chart displays correctly
- [ ] **Verify:** Payment status distribution chart shows categories
- [ ] **Verify:** Data updates when you mark tuitions as paid

---

## 7. Database Consistency Testing

### Direct Database Queries
Run these queries in Supabase SQL Editor to verify data integrity:

```sql
-- Check student final_tuition_value calculation
SELECT 
  name,
  full_tuition_value,
  discount,
  final_tuition_value,
  full_tuition_value * (1 - discount / 100) as expected_final
FROM students
WHERE final_tuition_value != full_tuition_value * (1 - COALESCE(discount, 0) / 100);
-- Expected: No rows (all calculations correct)

-- Check tuitions final_amount calculation
SELECT 
  id,
  amount,
  discount_applied,
  penalty_amount,
  final_amount,
  amount - COALESCE(discount_applied, 0) + COALESCE(penalty_amount, 0) as expected_final
FROM tuitions
WHERE final_amount != amount - COALESCE(discount_applied, 0) + COALESCE(penalty_amount, 0);
-- Expected: No rows (all calculations correct)

-- Verify contract-tuition linkage
SELECT 
  c.id as contract_id,
  c.student_id,
  COUNT(t.id) as tuition_count
FROM contracts c
LEFT JOIN tuitions t ON t.contract_id = c.id
WHERE c.status = 'active'
GROUP BY c.id, c.student_id
HAVING COUNT(t.id) = 0;
-- Expected: No rows (all active contracts have tuitions)

-- Check for orphaned records
SELECT 'Orphaned student' as issue, id, name FROM students WHERE class_id IS NOT NULL AND class_id NOT IN (SELECT id FROM classes)
UNION ALL
SELECT 'Orphaned class' as issue, id, name FROM classes WHERE teacher_id IS NOT NULL AND teacher_id NOT IN (SELECT id FROM teachers)
UNION ALL
SELECT 'Orphaned contract' as issue, id, student_id FROM contracts WHERE student_id NOT IN (SELECT id FROM students);
-- Expected: No rows
```

---

## 8. Edge Cases & Error Handling

### Invalid Data Entry
- [ ] Try entering decimal discount (e.g., 10.5)
- [ ] **Expected:** Accepts and calculates correctly
- [ ] Try entering very large tuition value (e.g., 999999.99)
- [ ] **Expected:** Accepts if < database max
- [ ] Try entering negative values where not allowed
- [ ] **Expected:** Validation prevents

### Network Errors
- [ ] Disconnect internet
- [ ] Try creating a student
- [ ] **Expected:** Error toast with appropriate message
- [ ] Reconnect internet
- [ ] Retry operation
- [ ] **Expected:** Success

### Concurrent Edits
- [ ] Open same student in two browser tabs
- [ ] Edit in both tabs
- [ ] Save first tab
- [ ] Save second tab
- [ ] **Expected:** Second save overwrites first (last write wins)
- [ ] **Verify:** No data corruption

### Select Dropdowns
- [ ] **Verify:** No `<SelectItem value="">` with empty strings
- [ ] **Verify:** All selects use UUIDs or valid values
- [ ] **Verify:** Placeholder text shows when nothing selected
- [ ] **Verify:** Selected value displays correctly

---

## 9. Performance Testing

### Large Data Sets
- [ ] Create 100+ students
- [ ] **Verify:** Table loads within 2 seconds
- [ ] **Verify:** Search/filter is responsive
- [ ] **Verify:** Pagination works (if implemented)

### Dashboard Load Time
- [ ] Clear cache and reload dashboard
- [ ] **Verify:** Metrics load within 3 seconds
- [ ] **Verify:** Charts render without errors
- [ ] **Verify:** No console errors

---

## 10. Calculation Verification Tests

### Student Final Tuition
Test various discount scenarios:
- [ ] R$ 500, 0% discount → R$ 500.00 ✓
- [ ] R$ 500, 10% discount → R$ 450.00 ✓
- [ ] R$ 500, 50% discount → R$ 250.00 ✓
- [ ] R$ 500, 100% discount → R$ 0.00 ✓
- [ ] R$ 1234.56, 12.5% discount → R$ 1080.24 ✓

### Tuition Final Amount
Test with discounts and penalties:
- [ ] Amount R$ 500, Discount R$ 50, Penalty R$ 0 → R$ 450 ✓
- [ ] Amount R$ 500, Discount R$ 0, Penalty R$ 25 → R$ 525 ✓
- [ ] Amount R$ 500, Discount R$ 50, Penalty R$ 25 → R$ 475 ✓

### Class Revenue
Test revenue calculations:
- [ ] 20 students × R$ 500/student → R$ 10,000.00 ✓
- [ ] 0 students × R$ 500/student → R$ 0.00 ✓
- [ ] 30 students × R$ 0/student → R$ 0.00 ✓

---

## 11. Export & Reports Testing

*Note: If export functionality exists*

- [ ] Export students to CSV
- [ ] **Verify:** All columns use snake_case names
- [ ] **Verify:** final_tuition_value included
- [ ] Export classes to CSV
- [ ] **Verify:** grade and monthly_fee included
- [ ] Export tuitions to CSV
- [ ] **Verify:** contract_id, discount_applied, penalty_amount, final_amount included

---

## 12. Role-Based Access Testing

*If RLS policies are active*

### Teacher Role
- [ ] Login as teacher
- [ ] **Verify:** Can view students, classes, tuitions
- [ ] **Verify:** Cannot create/edit/delete (if restricted)

### Financial Role
- [ ] Login as financial user
- [ ] **Verify:** Can manage contracts and tuitions
- [ ] **Verify:** Can mark tuitions as paid

### Admin Role
- [ ] Login as admin
- [ ] **Verify:** Full access to all features

---

## Test Results Summary

**Date:** ___________  
**Tester:** ___________  
**Environment:** ___________ (dev/staging/production)

### Overall Status
- [ ] ✅ All tests passed
- [ ] ⚠️ Some tests passed with minor issues (document below)
- [ ] ❌ Critical failures found (document below)

### Issues Found
List any issues discovered during testing:

1. ___________________________________________
2. ___________________________________________
3. ___________________________________________

### Sign-off
- [ ] Code review approved
- [ ] QA testing completed
- [ ] Ready for production deployment

**Approved by:** ___________  
**Date:** ___________

---

## Post-Deployment Verification

*After deploying to production*

- [ ] Verify 5 random students have correct final_tuition_value
- [ ] Verify 5 random contracts have generated tuitions
- [ ] Verify dashboard shows correct totals
- [ ] Monitor error logs for 24 hours
- [ ] Confirm no user-reported calculation errors

---

**End of QA Checklist**

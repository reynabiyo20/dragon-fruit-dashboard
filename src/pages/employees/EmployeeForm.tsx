import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import type { Employee } from '../../types';
import { useEmployeeStore } from '../../store/employeeStore';
import { InputField, TextareaField, DisplayField } from '../../components/forms/FormField';
import { CreatableSelect } from '../../components/forms/CreatableSelect';
import { Button } from '../../components/ui/Button';
import { DuplicateWarning } from '../../components/forms/DuplicateWarning';
import { useDuplicateCheck } from '../../hooks/useDuplicateCheck';
import { formatPHP } from '../../utils/format';
import {
  useEmployeeTypeStore, useEmployeePositionStore,
  useLaborTypeStore, useAccountingClassificationStore,
} from '../../store/optionStores';
import { laborDefaultsForRole } from '../../constants';
import { ENTITY, toastSuccess, requiredMsg, FIELD } from '../../constants/messages';

const schema = z.object({
  name: z.string().min(1, requiredMsg('Name')),
  position: z.string().min(1, requiredMsg('Position')),
  employeeType: z.string().min(1, requiredMsg('Employee type')),
  laborType: z.string(),
  accountingClassification: z.string(),
  dailyRate: z.coerce.number().min(0),
  commission: z.coerce.number().min(0).max(100, 'Commission must be 0–100%'),
  notes: z.string(),
});

type FormValues = z.infer<typeof schema>;

interface EmployeeFormProps {
  employee: Employee | null;
  onClose: () => void;
}

export function EmployeeForm({ employee, onClose }: EmployeeFormProps) {
  const { employees, addEmployee, updateEmployee } = useEmployeeStore();
  // Subscribe to `values` (not the options() fn) so the dropdown re-renders when a type is added
  const employeeTypeValues = useEmployeeTypeStore((s) => s.values);
  const addEmployeeType = useEmployeeTypeStore((s) => s.add);
  const typeOptions = employeeTypeValues.map((v) => ({ value: v, label: v }));
  // Editable position list (create-new supported)
  const positionValues = useEmployeePositionStore((s) => s.values);
  const addPosition = useEmployeePositionStore((s) => s.add);
  const positionOptions = positionValues.map((v) => ({ value: v, label: v }));
  // Labor type + accounting classification option lists (bookkeeping).
  const laborTypeValues = useLaborTypeStore((s) => s.values);
  const addLaborType = useLaborTypeStore((s) => s.add);
  const laborTypeOptions = laborTypeValues.map((v) => ({ value: v, label: v }));
  const acValues = useAccountingClassificationStore((s) => s.values);
  const addAccountingClassification = useAccountingClassificationStore((s) => s.add);
  const acOptions = acValues.map((v) => ({ value: v, label: v }));
  const isEditing = !!employee;

  const { register, handleSubmit, control, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      name: employee?.name ?? '',
      position: employee?.position ?? '',
      employeeType: employee?.employeeType ?? 'Full Time',
      // Keep the saved labor bookkeeping when editing; a new employee's fields
      // fill in when the position is chosen (see handlePositionChange).
      laborType: employee?.laborType ?? '',
      accountingClassification: employee?.accountingClassification ?? '',
      dailyRate: employee?.dailyRate ?? 0,
      commission: employee?.commission ?? 0,
      notes: employee?.notes ?? '',
    },
  });

  const dailyRate = useWatch({ control, name: 'dailyRate' }) ?? 0;
  const weeklyRate = Number(dailyRate) * 5;
  const monthlySalary = weeklyRate * 4;

  // Duplicate detection on employee name
  const empName = useWatch({ control, name: 'name' });
  const candidates = employee ? employees.filter((e) => e.id !== employee.id) : employees;
  const duplicates = useDuplicateCheck(
    candidates,
    [{ label: 'Name', value: empName ?? '', of: (e) => e.name }],
    !isEditing
  );

  // Picking a position prefills the labor bookkeeping defaults for that role,
  // but only fills a field that's still empty so it never clobbers a manual
  // choice or an edited employee's saved values.
  const handlePositionChange = (v: string) => {
    setValue('position', v, { shouldValidate: true, shouldDirty: true });
    const labor = laborDefaultsForRole(v);
    if (!watch('laborType')?.trim()) {
      setValue('laborType', labor.laborType, { shouldDirty: true });
    }
    if (!watch('accountingClassification')?.trim()) {
      setValue('accountingClassification', labor.accountingClassification, { shouldDirty: true });
    }
  };

  const onSubmit = (data: FormValues) => {
    if (employee) {
      updateEmployee(employee.id, data);
      toast.success(toastSuccess(ENTITY.employee, 'updated'));
    } else {
      addEmployee(data);
      toast.success(toastSuccess(ENTITY.employee, 'created'));
    }
    onClose();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {!isEditing && (
        <DuplicateWarning
          matches={duplicates}
          atLimit={duplicates.length >= 5}
          labelOf={(e) => `${e.name} · ${e.position}`}
          keyOf={(e) => e.id}
          noun="employee"
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <InputField label="Full Name" required autoFocus error={errors.name?.message} {...register('name')} placeholder="e.g. Don" />
        <CreatableSelect
          label="Position"
          required
          value={watch('position')}
          options={positionOptions}
          onChange={handlePositionChange}
          onCreate={(v) => { addPosition(v); handlePositionChange(v); }}
          placeholder="Select position…"
          createLabel="+ Create new position…"
          newFieldLabel="New Position"
          newFieldPlaceholder="e.g. Harvester"
          error={errors.position?.message}
        />
      </div>

      <CreatableSelect
        label="Employee Type"
        required
        value={watch('employeeType')}
        options={typeOptions}
        onChange={(v) => setValue('employeeType', v, { shouldValidate: true, shouldDirty: true })}
        onCreate={addEmployeeType}
        placeholder="Select type…"
        createLabel="+ Create new type…"
        newFieldLabel="New Employee Type"
        newFieldPlaceholder="e.g. Intern"
        error={errors.employeeType?.message}
      />

      {/* Labor bookkeeping — defaults from the role, editable. Feeds the payroll
          COGS-vs-OpEx breakdowns in Reports & the Dashboard. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <CreatableSelect
          label="Labor Type"
          value={watch('laborType')}
          options={laborTypeOptions}
          onChange={(v) => setValue('laborType', v, { shouldDirty: true })}
          onCreate={(v) => { addLaborType(v); setValue('laborType', v, { shouldDirty: true }); }}
          placeholder="Defaults from position…"
          createLabel="+ Add new labor type…"
          newFieldLabel="New Labor Type"
          newFieldPlaceholder="e.g. Direct Labor"
        />
        <CreatableSelect
          label="Accounting Classification"
          value={watch('accountingClassification')}
          options={acOptions}
          onChange={(v) => setValue('accountingClassification', v, { shouldDirty: true })}
          onCreate={(v) => { addAccountingClassification(v); setValue('accountingClassification', v, { shouldDirty: true }); }}
          placeholder="Defaults from position…"
          createLabel="+ Add new classification…"
          newFieldLabel="New accounting classification"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <InputField label="Daily Rate (₱)" type="number" step="0.01" error={errors.dailyRate?.message} {...register('dailyRate')} hint="Weekly & monthly rates auto-calculated" />
        <InputField label="Commission (%)" type="number" step="0.01" min="0" max="100" error={errors.commission?.message} {...register('commission')} hint="Percentage of sales they make (e.g. 3 = 3%)" />
      </div>

      {/* Auto-calculated read-only */}
      <div className="grid grid-cols-2 gap-4 p-3 bg-primary-50 rounded-lg border border-primary-100">
        <DisplayField label="Weekly Rate (auto)" value={formatPHP(weeklyRate)} highlight />
        <DisplayField label="Monthly Salary (auto)" value={formatPHP(monthlySalary)} highlight />
      </div>

      <TextareaField label={FIELD.notes.label} {...register('notes')} rows={2} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{employee ? 'Save Changes' : 'Add Employee'}</Button>
      </div>
    </form>
  );
}

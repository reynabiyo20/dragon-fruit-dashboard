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
import { useEmployeeTypeStore, useEmployeePositionStore } from '../../store/optionStores';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  position: z.string().min(1, 'Position is required'),
  employeeType: z.string().min(1, 'Employee type is required'),
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
  const isEditing = !!employee;

  const { register, handleSubmit, control, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: employee?.name ?? '',
      position: employee?.position ?? '',
      employeeType: employee?.employeeType ?? 'Full Time',
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

  const onSubmit = (data: FormValues) => {
    if (employee) {
      updateEmployee(employee.id, data);
      toast.success('Employee updated');
    } else {
      addEmployee(data);
      toast.success('Employee added');
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
          onChange={(v) => setValue('position', v, { shouldValidate: true, shouldDirty: true })}
          onCreate={addPosition}
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

      <div className="grid grid-cols-2 gap-4">
        <InputField label="Daily Rate (₱)" type="number" step="0.01" error={errors.dailyRate?.message} {...register('dailyRate')} hint="Weekly & monthly rates auto-calculated" />
        <InputField label="Commission (%)" type="number" step="0.01" min="0" max="100" error={errors.commission?.message} {...register('commission')} hint="Percentage of sales they make (e.g. 3 = 3%)" />
      </div>

      {/* Auto-calculated read-only */}
      <div className="grid grid-cols-2 gap-4 p-3 bg-primary-50 rounded-lg border border-primary-100">
        <DisplayField label="Weekly Rate (auto)" value={formatPHP(weeklyRate)} highlight />
        <DisplayField label="Monthly Salary (auto)" value={formatPHP(monthlySalary)} highlight />
      </div>

      <TextareaField label="Notes" {...register('notes')} rows={2} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={isSubmitting}>{employee ? 'Save Changes' : 'Add Employee'}</Button>
      </div>
    </form>
  );
}

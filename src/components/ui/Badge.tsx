type BadgeVariant = 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'purple' | 'primary' | 'berry';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

const classes: Record<BadgeVariant, string> = {
  green:   'bg-leaf-100 text-leaf-700',
  red:     'bg-red-100 text-red-700',
  yellow:  'bg-gold-100 text-gold-700',
  blue:    'bg-primary-100 text-primary-700',
  gray:    'bg-gray-100 text-gray-600',
  purple:  'bg-primary-100 text-primary-700',
  primary: 'bg-primary-100 text-primary-700',
  berry:   'bg-berry-100 text-berry-700',
};

export function Badge({ label, variant = 'gray' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes[variant]}`}>
      {label}
    </span>
  );
}

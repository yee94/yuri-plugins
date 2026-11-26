import type { JSX } from '@solidjs/web';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export type LabelProps = Omit<JSX.LabelHTMLAttributes<HTMLLabelElement>, 'class'> & {
  class?: string;
};

export function Label(props: LabelProps) {
  const rest = omit(props, 'class');
  return (
    <label
      data-slot="label"
      {...rest}
      class={cn(
        'flex items-center gap-2 text-xs leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        props.class,
      )}
    />
  );
}

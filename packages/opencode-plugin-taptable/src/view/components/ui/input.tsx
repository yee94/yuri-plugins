import { Input as UiInput } from '@ui-sdk/solid/input';
import type { ComponentProps } from 'solid-js';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export type InputProps = Omit<ComponentProps<typeof UiInput>, 'class'> & {
  class?: string;
};

export function Input(props: InputProps) {
  const rest = omit(props, 'class');
  return (
    <UiInput
      {...rest}
      class={cn(
        'flex h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-xs text-foreground shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )}
    />
  );
}

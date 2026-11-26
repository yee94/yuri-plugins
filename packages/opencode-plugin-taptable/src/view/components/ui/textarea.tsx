import { Textarea as UiTextarea } from '@ui-sdk/solid/textarea';
import type { ComponentProps } from 'solid-js';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export type TextareaProps = Omit<ComponentProps<typeof UiTextarea>, 'class'> & {
  class?: string;
};

export function Textarea(props: TextareaProps) {
  const rest = omit(props, 'class');
  return (
    <UiTextarea
      {...rest}
      class={cn(
        'flex w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-xs leading-relaxed text-foreground shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )}
    />
  );
}

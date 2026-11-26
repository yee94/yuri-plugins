import { Separator as UiSeparator } from '@ui-sdk/solid/separator';
import type { ComponentProps } from 'solid-js';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export type SeparatorProps = Omit<ComponentProps<typeof UiSeparator>, 'class'> & {
  class?: string;
};

export function Separator(props: SeparatorProps) {
  const rest = omit(props, 'class');
  return (
    <UiSeparator
      decorative
      {...rest}
      class={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        props.class,
      )}
    />
  );
}

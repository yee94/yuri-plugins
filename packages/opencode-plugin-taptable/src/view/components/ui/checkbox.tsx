import {
  Checkbox as UiCheckbox,
  CheckboxIndicator as UiCheckboxIndicator,
} from '@ui-sdk/solid/checkbox';
import type { ComponentProps } from 'solid-js';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';
import { CheckIcon } from '../icons';

export type CheckboxProps = Omit<ComponentProps<typeof UiCheckbox>, 'class' | 'children'> & {
  class?: string;
};

export function Checkbox(props: CheckboxProps) {
  const rest = omit(props, 'class');
  return (
    <UiCheckbox
      {...rest}
      class={cn(
        'peer inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-input bg-background text-primary-foreground shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-primary data-checked:bg-primary',
        props.class,
      )}
    >
      <UiCheckboxIndicator class="flex items-center justify-center text-current">
        <CheckIcon class="h-3 w-3" />
      </UiCheckboxIndicator>
    </UiCheckbox>
  );
}

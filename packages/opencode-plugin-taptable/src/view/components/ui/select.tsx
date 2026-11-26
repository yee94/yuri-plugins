import {
  Select as UiSelect,
  SelectContent as UiSelectContent,
  SelectItem as UiSelectItem,
  SelectItemIndicator as UiSelectItemIndicator,
  SelectTrigger as UiSelectTrigger,
  SelectValue as UiSelectValue,
} from '@ui-sdk/solid/select';
import type { JSX } from '@solidjs/web';
import type { ComponentProps } from 'solid-js';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';
import { CheckIcon, ChevronDownIcon } from '../icons';

export const Select = UiSelect;

export type SelectTriggerProps = Omit<ComponentProps<typeof UiSelectTrigger>, 'class'> & {
  class?: string;
  hideChevron?: boolean;
};

export function SelectTrigger(props: SelectTriggerProps) {
  const rest = omit(props, 'class', 'children', 'hideChevron');
  return (
    <UiSelectTrigger
      {...rest}
      class={cn(
        'inline-flex h-8 cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs text-foreground shadow-xs transition-[color,box-shadow] outline-none hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )}
    >
      {props.children}
      {!props.hideChevron && (
        <ChevronDownIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-70" />
      )}
    </UiSelectTrigger>
  );
}

export type SelectValueProps = Omit<ComponentProps<typeof UiSelectValue>, 'class'> & {
  class?: string;
};

export function SelectValue(props: SelectValueProps) {
  const rest = omit(props, 'class');
  return (
    <UiSelectValue
      {...rest}
      class={cn('truncate data-placeholder:text-muted-foreground', props.class)}
    />
  );
}

export type SelectContentProps = Omit<ComponentProps<typeof UiSelectContent>, 'class'> & {
  class?: string;
};

export function SelectContent(props: SelectContentProps) {
  const rest = omit(props, 'class');
  return (
    <UiSelectContent
      sideOffset={4}
      {...rest}
      class={cn(
        'z-50 max-h-[min(18rem,var(--available-height,18rem))] min-w-[max(7.5rem,var(--anchor-width,7.5rem))] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none origin-(--transform-origin) transition-[opacity,scale] duration-120 data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0',
        props.class,
      )}
    />
  );
}

export type SelectItemProps<T = string> = Omit<
  ComponentProps<typeof UiSelectItem<T>>,
  'class' | 'children'
> & {
  class?: string;
  children?: JSX.Element;
};

export function SelectItem<T = string>(props: SelectItemProps<T>) {
  const rest = omit(props, 'class', 'children');
  return (
    <UiSelectItem
      {...(rest as any)}
      class={cn(
        'relative flex cursor-pointer items-center justify-between gap-2 rounded-sm py-1.5 pr-7 pl-2 text-xs text-popover-foreground outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        props.class,
      )}
    >
      <span class="flex min-w-0 items-center gap-1.5 truncate">{props.children}</span>
      <UiSelectItemIndicator class="pointer-events-none absolute right-2 flex h-3.5 w-3.5 items-center justify-center text-muted-foreground">
        <CheckIcon class="h-3.5 w-3.5" />
      </UiSelectItemIndicator>
    </UiSelectItem>
  );
}

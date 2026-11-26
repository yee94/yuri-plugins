import {
  AlertDialog as UiAlertDialog,
  AlertDialogBackdrop as UiAlertDialogBackdrop,
  AlertDialogClose as UiAlertDialogClose,
  AlertDialogContent as UiAlertDialogContent,
  AlertDialogDescription as UiAlertDialogDescription,
  AlertDialogTitle as UiAlertDialogTitle,
  AlertDialogTrigger as UiAlertDialogTrigger,
} from '@ui-sdk/solid/alert-dialog';
import type { JSX } from '@solidjs/web';
import type { ComponentProps } from 'solid-js';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export const AlertDialog = UiAlertDialog;
export const AlertDialogTrigger = UiAlertDialogTrigger;
export const AlertDialogClose = UiAlertDialogClose;

export type AlertDialogBackdropProps = Omit<
  ComponentProps<typeof UiAlertDialogBackdrop>,
  'class'
> & {
  class?: string;
};

export function AlertDialogBackdrop(props: AlertDialogBackdropProps) {
  const rest = omit(props, 'class');
  return (
    <UiAlertDialogBackdrop
      {...rest}
      class={cn(
        'fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0',
        props.class,
      )}
    />
  );
}

export type AlertDialogContentProps = Omit<ComponentProps<typeof UiAlertDialogContent>, 'class'> & {
  class?: string;
};

export function AlertDialogContent(props: AlertDialogContentProps) {
  const rest = omit(props, 'class');
  return (
    <>
      <AlertDialogBackdrop />
      <UiAlertDialogContent
        {...rest}
        class={cn(
          'fixed inset-0 z-50 m-auto grid h-fit w-[calc(100%-2rem)] max-w-md gap-4 rounded-lg border border-border bg-background p-6 text-foreground shadow-lg outline-none transition-[opacity,scale] duration-150 data-starting-style:scale-96 data-starting-style:opacity-0 data-ending-style:scale-96 data-ending-style:opacity-0',
          props.class,
        )}
      />
    </>
  );
}

export function AlertDialogHeader(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class'> & { class?: string },
) {
  const rest = omit(props, 'class');
  return (
    <div
      data-slot="alert-dialog-header"
      {...rest}
      class={cn('flex flex-col gap-2 text-center sm:text-left', props.class)}
    />
  );
}

export function AlertDialogFooter(
  props: Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class'> & { class?: string },
) {
  const rest = omit(props, 'class');
  return (
    <div
      data-slot="alert-dialog-footer"
      {...rest}
      class={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', props.class)}
    />
  );
}

export type AlertDialogTitleProps = Omit<ComponentProps<typeof UiAlertDialogTitle>, 'class'> & {
  class?: string;
};

export function AlertDialogTitle(props: AlertDialogTitleProps) {
  const rest = omit(props, 'class');
  return (
    <UiAlertDialogTitle
      {...rest}
      class={cn('text-base font-semibold text-foreground', props.class)}
    />
  );
}

export type AlertDialogDescriptionProps = Omit<
  ComponentProps<typeof UiAlertDialogDescription>,
  'class'
> & {
  class?: string;
};

export function AlertDialogDescription(props: AlertDialogDescriptionProps) {
  const rest = omit(props, 'class');
  return (
    <UiAlertDialogDescription
      {...rest}
      class={cn('text-xs leading-relaxed text-muted-foreground', props.class)}
    />
  );
}

export type AlertDialogActionProps = Omit<ComponentProps<typeof UiAlertDialogClose>, 'class'> & {
  class?: string;
};

export function AlertDialogAction(props: AlertDialogActionProps) {
  const rest = omit(props, 'class');
  return (
    <UiAlertDialogClose
      value="confirm"
      {...rest}
      class={cn(
        'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-md bg-primary px-3 text-xs font-medium whitespace-nowrap text-primary-foreground shadow-xs transition-colors outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        props.class,
      )}
    />
  );
}

export function AlertDialogCancel(props: AlertDialogActionProps) {
  const rest = omit(props, 'class');
  return (
    <UiAlertDialogClose
      value="cancel"
      {...rest}
      class={cn(
        'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-background px-3 text-xs font-medium whitespace-nowrap text-foreground shadow-xs transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        props.class,
      )}
    />
  );
}

import React from 'react';

function host(name) {
  return function CarbonStub(props = {}) {
    const record = {
      name,
      disabled: Object.prototype.hasOwnProperty.call(props, 'disabled') ? props.disabled : null,
      value: Object.prototype.hasOwnProperty.call(props, 'value') ? props.value : null,
      valueSelected: Object.prototype.hasOwnProperty.call(props, 'valueSelected') ? props.valueSelected : null,
      labelText: typeof props.labelText === 'string' ? props.labelText : null,
      id: props.id ?? null,
      readOnly: Object.prototype.hasOwnProperty.call(props, 'readOnly') ? props.readOnly : null,
      onClick: typeof props.onClick === 'function' ? props.onClick : null,
      onChange: typeof props.onChange === 'function' ? props.onChange : null,
    };
    (globalThis.__rbsUi ??= []).push(record);
    return React.createElement('div', { 'data-carbon': name }, props.legendText, props.children);
  };
}

export const Accordion = host('Accordion');
export const AccordionItem = host('AccordionItem');
export const Button = host('Button');
export const ButtonSet = host('ButtonSet');
export const Checkbox = host('Checkbox');
export const CheckboxGroup = host('CheckboxGroup');
export const ComboBox = host('ComboBox');
export const ContentSwitcher = host('ContentSwitcher');
export const DefinitionTooltip = host('DefinitionTooltip');
export const Dropdown = host('Dropdown');
export const DropdownSkeleton = host('DropdownSkeleton');
export const FilterableMultiSelect = host('FilterableMultiSelect');
export const FormGroup = host('FormGroup');
export const InlineLoading = host('InlineLoading');
export const InlineNotification = host('InlineNotification');
export const Layer = host('Layer');
export const NumberInput = host('NumberInput');
export const RadioButton = host('RadioButton');
export const RadioButtonGroup = host('RadioButtonGroup');
export const Switch = host('Switch');
export const Tag = host('Tag');
export const TextArea = host('TextArea');
export const TextInput = host('TextInput');
export const TimePicker = host('TimePicker');
export const ToastNotification = host('ToastNotification');
export const Toggle = host('Toggle');
export const Tooltip = host('Tooltip');

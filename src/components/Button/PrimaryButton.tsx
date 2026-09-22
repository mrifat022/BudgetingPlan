import React from 'react';
import Colors from '../../constants/colors';
import Typography from '../../constants/typography';
import {
  Pressable,
  Text,
  StyleSheet,
} from 'react-native';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
};

function PrimaryButton({title, onPress, disabled = false, variant = 'primary'}: Props) {
  return (
    <Pressable
      style={[
        styles.button,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.danger,
        disabled && styles.disabled,
      ]}
      disabled={disabled}
      onPress={onPress}>
      <Text style={[styles.text, variant === 'secondary' && styles.secondaryText]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  secondaryText: {color: Colors.primary},
  danger: {backgroundColor: Colors.danger},
  disabled: {opacity: 0.5},

  text: {
    color: Colors.white,
    fontSize: Typography.body,
    fontWeight: '600',
  },
});

export default PrimaryButton;

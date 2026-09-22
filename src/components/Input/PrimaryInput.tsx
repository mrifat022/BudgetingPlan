import React from 'react';
import Colors from '../../constants/colors';
import Typography from '../../constants/typography';
import { TextInput, StyleSheet, View, type TextInputProps } from 'react-native';

type Props = Pick<
  TextInputProps,
  'autoCapitalize' | 'keyboardType' | 'returnKeyType'
> & {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
};

function PrimaryInput({
  placeholder,
  value,
  onChangeText,
  secureTextEntry = false,
  autoCapitalize,
  keyboardType,
  returnKeyType,
}: Props) {
  return (
    <View>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={Colors.textSecondary}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        returnKeyType={returnKeyType}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    height: 50,
    fontSize: Typography.body,
    marginBottom: 15,
    backgroundColor: Colors.white,
    color: Colors.textPrimary,
  },
});

export default PrimaryInput;

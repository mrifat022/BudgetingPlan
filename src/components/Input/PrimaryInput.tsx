import React, {useState} from 'react';
import Colors from '../../constants/colors';
import Typography from '../../constants/typography';
import {Pressable, TextInput, StyleSheet, View, type TextInputProps} from 'react-native';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';

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
  const [hidden, setHidden] = useState(secureTextEntry);
  return (
    <View style={styles.wrap}>
      <TextInput
        style={[styles.input, secureTextEntry && styles.secureInput]}
        placeholder={placeholder}
        placeholderTextColor={Colors.textSecondary}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry && hidden}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        returnKeyType={returnKeyType}
      />
      {secureTextEntry ? <Pressable accessibilityLabel={hidden ? 'Tampilkan password' : 'Sembunyikan password'} style={styles.eye} onPress={() => setHidden(current => !current)}><MaterialCommunityIcons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={22} color={Colors.textSecondary} /></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {position: 'relative'},
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 58,
    fontSize: Typography.body,
    marginBottom: 15,
    backgroundColor: Colors.white,
    color: Colors.textPrimary,
  },
  secureInput: {paddingRight: 50},
  eye: {position: 'absolute', right: 4, top: 0, width: 48, height: 58, alignItems: 'center', justifyContent: 'center'},
});

export default PrimaryInput;

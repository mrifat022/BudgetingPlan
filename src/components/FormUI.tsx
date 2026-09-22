import React, {useEffect} from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Picker} from '@react-native-picker/picker';
import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import Colors from '../constants/colors';
import PrimaryCurrencyInput from './CurrencyInput/PrimaryCurrencyInput';
import PrimaryButton from './Button/PrimaryButton';

export function FormModal({visible, title, onClose, children}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Pressable accessibilityLabel="Tutup" style={styles.close} onPress={onClose}>
            <MaterialCommunityIcons name="close" size={24} color={Colors.textPrimary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export function Label({children}: {children: React.ReactNode}) {
  return <Text style={styles.label}>{children}</Text>;
}

export function TextField(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor="#99A39F" {...props} style={[styles.input, props.multiline && styles.multiline, props.style]} />;
}

export function MoneyField({value, onChangeValue}: {value: number | null; onChangeValue: (value: number | null) => void}) {
  return <PrimaryCurrencyInput value={value} onChangeValue={onChangeValue} />;
}

export function SelectField({value, onChange, options}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{label: string; value: string}>;
}) {
  const hasSelectedValue = options.some(option => option.value === value);
  const selectedValue = hasSelectedValue ? value : options[0]?.value ?? '';

  // Android dapat menyorot opsi pertama tanpa menyimpan nilainya ke state JS.
  // Sinkronkan nilai fallback supaya tampilan dan validasi selalu konsisten.
  useEffect(() => {
    if (!hasSelectedValue && selectedValue) {
      onChange(selectedValue);
    }
  }, [hasSelectedValue, onChange, selectedValue]);

  return (
    <View style={styles.pickerWrap}>
      <Picker
        selectedValue={selectedValue}
        onValueChange={itemValue => onChange(String(itemValue))}
        style={styles.picker}
        dropdownIconColor={Colors.textSecondary}>
        {options.map(option => (
          <Picker.Item
            key={option.value}
            label={option.label}
            value={option.value}
            color={Colors.textPrimary}
          />
        ))}
      </Picker>
    </View>
  );
}

export function FormActions({saveLabel = 'Simpan', onSave, onCancel, disabled}: {
  saveLabel?: string;
  onSave: () => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.actions}>
      <View style={styles.action}><PrimaryButton title="Batal" variant="secondary" onPress={onCancel} /></View>
      <View style={styles.action}><PrimaryButton title={saveLabel} disabled={disabled} onPress={onSave} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: Colors.background},
  modalHeader: {height: 66, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.surface},
  modalTitle: {fontSize: 20, fontWeight: '800', color: Colors.textPrimary},
  close: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center'},
  content: {padding: 20, paddingBottom: 36},
  label: {fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginTop: 14, marginBottom: 7},
  input: {height: 50, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 16, fontSize: 16, backgroundColor: Colors.surface, color: Colors.textPrimary},
  multiline: {height: 92, paddingTop: 13, textAlignVertical: 'top'},
  pickerWrap: {borderWidth: 1, borderColor: Colors.border, borderRadius: 10, overflow: 'hidden', backgroundColor: Colors.surface},
  picker: {color: Colors.textPrimary, backgroundColor: Colors.surface},
  actions: {flexDirection: 'row', gap: 10, marginTop: 28},
  action: {flex: 1},
});

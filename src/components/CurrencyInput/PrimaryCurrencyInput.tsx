import React from 'react';
import CurrencyInput from 'react-native-currency-input';
import {StyleSheet} from 'react-native';

import Colors from '../../constants/colors';
import Typography from '../../constants/typography';

type Props = {
  value: number | null;
  onChangeValue: (value: number | null) => void;
};

function PrimaryCurrencyInput({ value, onChangeValue }: Props) {
  return (
    <CurrencyInput
      value={value}
      onChangeValue={onChangeValue}
      prefix="Rp "
      delimiter="."
      separator=","
      precision={0}
      minValue={0}
      placeholder="Masukkan nominal"
      style={styles.input}
      keyboardType="numeric"
    />
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
    backgroundColor: Colors.white,
  },
});

export default PrimaryCurrencyInput;
